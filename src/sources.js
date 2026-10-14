// Material de apoyo del maestro (PDFs y fotos) → sources.md, un texto que va en los prompts.
// PDFs con texto: pdftotext. Fotos y PDFs escaneados: el modelo los transcribe (visión).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chat } from './openrouter.js';

const run = promisify(execFile);
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_SCAN_PAGES = 20;          // páginas de un PDF escaneado que se transcriben
const IMAGES_PER_CALL = 4;
export const MAX_SOURCE_CHARS = 60_000;

const TRANSCRIBE = `Transcribe this teacher's source material faithfully so it can be used to write a student workbook.
- Keep all text, headings, explanations, worked examples and exercises, in the original language.
- Write math in LaTeX inside $...$.
- Describe each diagram, figure or drawing briefly as [Figura: …], including any numbers or labels it shows.
- Note handwritten marks or answers as [Anotación: …].
Output Markdown only, no commentary.`;

async function transcribeImages(images, { model, label }) {
  const parts = [];
  for (let i = 0; i < images.length; i += IMAGES_PER_CALL) {
    const batch = images.slice(i, i + IMAGES_PER_CALL);
    const content = [{ type: 'text', text: TRANSCRIBE }];
    for (const img of batch) {
      const data = (await readFile(img.file)).toString('base64');
      content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${data}` } });
    }
    parts.push(await chat({ model, messages: [{ role: 'user', content }], maxTokens: 16000, temperature: 0.1, label }));
  }
  return parts.join('\n\n');
}

async function pdfText(file) {
  const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function pdfPages(file) {
  const { stdout } = await run('pdfinfo', [file]);
  return Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
}

async function digestOne(file, opts) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file);
  if (IMAGES[ext]) {
    opts.log(`  reading image ${name}…`);
    return transcribeImages([{ file, mime: IMAGES[ext] }], { model: opts.model, label: `source ${name}` });
  }
  if (ext !== '.pdf') throw new Error(`Unsupported source file: ${name} (use PDF, PNG, JPG or WEBP)`);

  const pages = await pdfPages(file);
  const text = await pdfText(file);
  // Con texto real (no escaneado) basta pdftotext.
  if (text.replace(/\s/g, '').length > 200 * Math.max(1, pages) * 0.5) {
    opts.log(`  reading PDF ${name} (${pages} pages, text)…`);
    return text.replace(/\f/g, '\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }
  opts.log(`  reading PDF ${name} (${pages} pages, scanned → transcribing ${Math.min(pages, MAX_SCAN_PAGES)})…`);
  const dir = await mkdtemp(path.join(tmpdir(), 'wb-src-'));
  try {
    await run('pdftoppm', ['-r', '110', '-png', '-l', String(MAX_SCAN_PAGES), file, path.join(dir, 'p')]);
    const imgs = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort().map((f) => ({ file: path.join(dir, f), mime: 'image/png' }));
    const out = await transcribeImages(imgs, { model: opts.model, label: `source ${name}` });
    return pages > MAX_SCAN_PAGES ? `${out}\n\n[Only the first ${MAX_SCAN_PAGES} of ${pages} pages were read.]` : out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Lee el material de apoyo y lo deja en <runDir>/sources.md (se reutiliza si ya existe).
 * Devuelve el texto, recortado a MAX_SOURCE_CHARS, o '' si no hay material.
 */
export async function digestSources(files, { runDir, model, force, log }) {
  const out = path.join(runDir, 'sources.md');
  if (existsSync(out) && !force) {
    log('Sources: using saved sources.md');
    return readFile(out, 'utf8');
  }
  if (!files.length) return '';
  log(`Sources: reading ${files.length} file(s) of teacher material…`);
  const sections = [];
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`Source file not found: ${file}`);
    sections.push({ name: path.basename(file), text: (await digestOne(file, { model, log })).trim() });
  }
  // Si se pasa del límite, cada archivo cede en proporción a su tamaño.
  const total = sections.reduce((n, s) => n + s.text.length, 0);
  const ratio = Math.min(1, MAX_SOURCE_CHARS / Math.max(1, total));
  const md = sections.map((s) => {
    const keep = Math.floor(s.text.length * ratio);
    const text = keep < s.text.length ? `${s.text.slice(0, keep)}\n\n[… recortado]` : s.text;
    return `## ${s.name}\n\n${text}`;
  }).join('\n\n---\n\n');
  await writeFile(out, md);
  return md;
}
