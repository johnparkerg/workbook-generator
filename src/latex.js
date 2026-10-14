import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const TEMPLATES = path.join(ROOT, 'templates');
const FONTS = path.join(ROOT, 'fonts');

const ESCAPES = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };

/** Escapa texto plano (títulos del plan, nombre de la marca) para LaTeX. */
export function esc(text = '') {
  return String(text).replace(/[\\&%$#_{}~^]/g, (c) => ESCAPES[c]);
}

function hex(color) {
  return String(color).replace(/^#/, '').toUpperCase();
}

/** Preámbulo completo: clase, idioma, marca y etiquetas, luego wb.sty. */
export function preamble({ brand, lang }) {
  const labels = Object.entries(lang.labels)
    .map(([k, v]) => `\\newcommand{\\wbL${k}}{${esc(v)}}`)
    .join('\n');
  const logo = brand.logo ? path.resolve(brand.logo) : '';
  return `\\documentclass[12pt]{article}
\\usepackage[${lang.babel}]{babel}
\\usepackage{xcolor}
\\definecolor{wbprimary}{HTML}{${hex(brand.colors.primary)}}
\\definecolor{wbsecondary}{HTML}{${hex(brand.colors.secondary)}}
\\definecolor{wbaccent}{HTML}{${hex(brand.colors.accent)}}
\\definecolor{wbpaper}{HTML}{${hex(brand.colors.paper)}}
\\newcommand{\\wbBrandName}{${esc(brand.name)}}
\\newcommand{\\wbFontDir}{${FONTS}/}
\\newcommand{\\wbLogo}{${logo}}
${labels}
\\usepackage{wb}
`;
}

/** Documento mínimo para verificar que una unidad compila por sí sola. */
export function unitTestDocument({ brand, lang, unitNumber, unitLatex, answersLatex }) {
  return `${preamble({ brand, lang })}
\\begin{document}
\\setcounter{wbunit}{${unitNumber - 1}}
${unitLatex}
\\begin{wbanswerkey}
${answersLatex}
\\end{wbanswerkey}
\\end{document}
`;
}

export function workbookDocument({ brand, lang, plan, units, levelLabel }) {
  const body = units.map((u) => u.latex).join('\n\n');
  const answers = units
    .map((u, i) => `\\wbanswerunit{${esc(lang.labels.Unit)} ${i + 1}: ${esc(plan.units[i].title)}}\n${u.answers}`)
    .join('\n\n');
  const intro = plan.intro ? `\\section*{${esc(plan.intro.title)}}\n${esc(plan.intro.text).replace(/\n\s*\n/g, '\n\n')}\n` : '';
  return `${preamble({ brand, lang })}
\\title{${esc(plan.title)}}
\\begin{document}
\\wbcover{${esc(plan.title)}}{${esc(plan.subtitle || '')}}{${esc(levelLabel)}}
\\pagestyle{wbmain}
\\wbnameline
${intro}
\\renewcommand{\\contentsname}{${esc(lang.labels.Contents)}}
{\\setlength{\\parskip}{0.2em}\\tableofcontents}

${body}

\\begin{wbanswerkey}
${answers}
\\end{wbanswerkey}
\\end{document}
`;
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env, TEXINPUTS: `${TEMPLATES}:${process.env.TEXINPUTS || ''}` };
    const p = spawn(cmd, args, { cwd, env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (err) => resolve({ code: -1, out: String(err) }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

/**
 * Compila `source` con xelatex en `dir` (passes veces, para el índice).
 * Devuelve { ok, pdf, errors } — errors es un resumen legible del log.
 */
export async function compile(source, dir, { name = 'main', passes = 1 } = {}) {
  await mkdir(dir, { recursive: true });
  const texFile = path.join(dir, `${name}.tex`);
  await writeFile(texFile, source);
  const logFile = path.join(dir, `${name}.log`);
  let res;
  // Al menos `passes` pasadas; después, otra más mientras LaTeX pida "Rerun"
  // (el índice o las posiciones de la portada de unidad cambiaron), hasta 5.
  for (let i = 0; i < 5; i++) {
    res = await run('xelatex', ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', `${name}.tex`], dir);
    if (res.code !== 0) break;
    if (i + 1 >= passes && !/Rerun to get/.test(await readFile(logFile, 'utf8'))) break;
  }
  const pdf = path.join(dir, `${name}.pdf`);
  if (res.code === 0 && existsSync(pdf)) return { ok: true, pdf, errors: '' };
  const log = existsSync(logFile) ? await readFile(logFile, 'utf8') : res.out;
  return { ok: false, pdf: null, errors: extractErrors(log, source) };
}

/** Saca del log de LaTeX los errores y la línea del .tex donde ocurrieron. */
export function extractErrors(log, source = '') {
  const lines = log.split('\n');
  const srcLines = source.split('\n');
  const out = [];
  for (let i = 0; i < lines.length && out.length < 5; i++) {
    const m = lines[i].match(/^(?:\S*\.tex:(\d+): |! )(.*)$/);
    if (!m) continue;
    const ctx = lines.slice(i + 1, i + 6).filter((l) => l.trim()).join('\n');
    let where = '';
    let lineNo = Number(m[1] || (ctx.match(/^l\.(\d+)/m) || [])[1]);
    // "Runaway argument?" (falta una llave) no trae número de línea: lo buscamos por el texto.
    let runaway = '';
    if (lines[i - 2]?.startsWith('Runaway argument?')) {
      runaway = `Runaway argument (probably a missing }): ${lines[i - 1]}\n`;
      const snippet = lines[i - 1].replace(/\\ETC\.$/, '').slice(0, 25);
      const idx = srcLines.findIndex((l) => l.includes(snippet));
      if (!lineNo && idx >= 0) lineNo = idx + 1;
    }
    if (lineNo && srcLines.length) {
      const from = Math.max(0, lineNo - 3);
      where = '\nSource around line ' + lineNo + ':\n' +
        srcLines.slice(from, lineNo + 2).map((l, k) => `${from + k + 1}${from + k + 1 === lineNo ? ' >' : '  '} ${l}`).join('\n');
    }
    out.push(`${runaway}${m[2]}\n${ctx}${where}`);
  }
  return out.join('\n---\n') || lines.slice(-30).join('\n');
}

export async function cleanDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

export { copyFile };
