// Revisión visual: se renderizan las páginas de una unidad ya compilada y un modelo con visión
// las mira en lotes. Sólo reporta problemas reales (un dibujo que no coincide con su texto,
// sombreado equivocado, elementos encimados…). Barato: unas cuantas llamadas por unidad.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chat } from './openrouter.js';
import { parseJson } from './prompts.js';

const run = promisify(execFile);
const PAGES_PER_CALL = 8;
const DPI = 55;

const PROMPT = (first, last, lang) => `These are pages ${first}–${last} of one unit of a printed student workbook in ${lang}, rendered from LaTeX.
Check them like a careful proofreader looking at the printed page. Report ONLY real defects:
- a drawing that does not show what the text says (wrong number of parts, wrong parts shaded, "unequal parts" drawn equal, number-line marks or labels in the wrong place, wrong count of objects)
- visible math or answers that are wrong
- elements overlapping, cut off, or running off the page; a figure separated from the question it belongs to
- empty or missing answer space where the student must write
Do NOT report style preferences, page breaks that are merely imperfect, or things that are fine.

Respond with ONLY JSON: {"issues": [{"page": <page number>, "problem": "<what is wrong, quoting the nearby text>", "fix": "<what to change>"}]}
Use {"issues": []} if everything is fine.`;

/** Devuelve [{page, problem, fix}] para la unidad compilada en `pdf`. */
export async function visualCheck({ pdf, lang, model, label }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wb-vis-'));
  try {
    await run('pdftoppm', ['-r', String(DPI), '-png', pdf, path.join(dir, 'p')]);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    const pageOf = (f) => Number(f.match(/(\d+)\.png$/)[1]);
    const issues = [];
    for (let i = 0; i < files.length; i += PAGES_PER_CALL) {
      const batch = files.slice(i, i + PAGES_PER_CALL);
      const first = pageOf(batch[0]);
      const last = pageOf(batch[batch.length - 1]);
      const content = [{ type: 'text', text: PROMPT(first, last, lang.name) }];
      for (const f of batch) {
        content.push({ type: 'text', text: `Page ${pageOf(f)}:` });
        content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${(await readFile(path.join(dir, f))).toString('base64')}` } });
      }
      const text = await chat({
        model, messages: [{ role: 'user', content }], maxTokens: 8000, maxTokensCap: 16000, temperature: 0.1,
        reasoning: { effort: 'low' }, label: `${label} pages ${first}-${last}`,
      });
      try {
        issues.push(...(parseJson(text).issues || []).filter((x) => x && x.problem));
      } catch {
        // Una respuesta ilegible no debe tumbar la unidad: se omite ese lote.
      }
    }
    return issues;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function issuesAsFeedback(issues) {
  return `A proofreader looked at the rendered pages and found these defects. Fix each one in the LaTeX (and the answer key if affected), changing nothing else:\n${
    issues.map((x) => `- page ${x.page}: ${x.problem}${x.fix ? ` → ${x.fix}` : ''}`).join('\n')}`;
}
