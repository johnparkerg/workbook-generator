// Modo agente: comandos que un agente (p. ej. Claude Code) usa desde la carpeta de trabajo.
// La carpeta tiene workbook.json (la especificación) y ahí viven plan.json, units/, sources.md.
//
//   wb guide              imprime la guía de autor (pedagogía, esquema del plan, LaTeX permitido)
//   wb sources            transcribe material/* → sources.md (necesita OPENROUTER_API_KEY)
//   wb check <n>          valida y compila units/unit-<n>.tex sola; imprime errores si los hay
//   wb build              arma el PDF completo con plan.json + units/
//   wb render <páginas> [--unit n]   PNGs de páginas para revisarlas a ojo (build/preview/)
//   wb progreso "<texto>" avisa a la maestra en qué vas (el corredor lo reenvía al panel)

import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { resolveLang, parseLevel, loadBrand, loadEnv } from './config.js';
import { compile, unitTestDocument, workbookDocument } from './latex.js';
import { parseUnitOutput, normalizePlan, PEDAGOGY, PLAN_SCHEMA, LATEX_VOCAB, OUTPUT_FORMAT } from './prompts.js';
import { digestSources } from './sources.js';

const run = promisify(execFile);

async function loadJob(dir) {
  const file = path.join(dir, 'workbook.json');
  if (!existsSync(file)) throw new Error(`No workbook.json in ${dir}`);
  const job = JSON.parse(await readFile(file, 'utf8'));
  const brand = { ...job.brand };
  if (brand.logo) brand.logo = path.resolve(dir, brand.logo);
  return {
    job,
    lang: resolveLang(job.lang || 'es_MX'),
    level: parseLevel(job.level || '1'),
    brand: loadBrand(brand.name || 'Miss Merab', { colors: brand.colors || {}, logo: brand.logo }),
  };
}

async function loadPlan(dir) {
  const file = path.join(dir, 'plan.json');
  if (!existsSync(file)) throw new Error('plan.json does not exist yet');
  const plan = normalizePlan(JSON.parse(await readFile(file, 'utf8')));
  if (!Array.isArray(plan.units) || !plan.units.length) throw new Error('plan.json has no units');
  return plan;
}

function levelLabel(lang, level) {
  return `${lang.labels.Level} ${level.level}${level.of ? ` ${lang.labels.Of} ${level.of}` : ''}`;
}

/** Revisiones baratas que el compilador no ve. */
function lint(unit) {
  const warnings = [];
  const practices = (unit.latex.match(/\\begin\{wbpractice\}/g) || []).length;
  const answerGroups = (unit.answers.match(/\\wbanswers\{/g) || []).length;
  const reviews = (unit.latex.match(/\\begin\{wbreview\}/g) || []).length;
  if (reviews !== 1) warnings.push(`expected exactly 1 wbreview, found ${reviews}`);
  if (answerGroups !== practices + reviews) {
    warnings.push(`answer key has ${answerGroups} \\wbanswers groups but the unit has ${practices} practice sets + ${reviews} review`);
  }
  if (/(^|[^\\$\d])\d+\s*\/\s*\d+(?![^$]*\$)/.test(unit.latex.replace(/\$[^$]*\$/g, ''))) {
    warnings.push('a fraction seems to be written as a/b in plain text; use $\\frac{a}{b}$');
  }
  return warnings;
}

const commands = {
  async guide() {
    console.log(`# Authoring guide

${PEDAGOGY}

## plan.json schema

${PLAN_SCHEMA}

Unit and lesson titles must not start with "Unit N:" / "Lesson N:" — numbering is automatic.

## Unit files (units/unit-<n>.tex)

${LATEX_VOCAB}

${OUTPUT_FORMAT}
`);
  },

  async sources(dir) {
    loadEnv();
    const materialDir = path.join(dir, 'material');
    const files = existsSync(materialDir) ? (await readdir(materialDir)).filter((f) => !f.startsWith('.')).map((f) => path.join(materialDir, f)) : [];
    if (!files.length) return console.log('No material/ files.');
    const md = await digestSources(files, { runDir: dir, model: process.env.OPENROUTER_MODEL || 'typesafe/jev-router', log: console.log });
    console.log(`sources.md: ${md.length} chars`);
  },

  async check(dir, args) {
    const n = Number(args[0]);
    if (!Number.isInteger(n) || n < 1) throw new Error('usage: wb check <unit number>');
    const file = path.join(dir, 'units', `unit-${n}.tex`);
    if (!existsSync(file)) throw new Error(`${path.relative(dir, file)} does not exist`);
    const unit = parseUnitOutput(await readFile(file, 'utf8'));
    const { lang, brand } = await loadJob(dir);
    const res = await compile(
      unitTestDocument({ brand, lang, unitNumber: n, unitLatex: unit.latex, answersLatex: unit.answers }),
      path.join(dir, 'build', `unit-${n}`), { name: `unit-${n}`, passes: 2 });
    const warnings = lint(unit);
    if (!res.ok) {
      console.log(`✗ unit ${n} does not compile:\n${res.errors}`);
      process.exitCode = 1;
      return;
    }
    const { stdout } = await run('pdfinfo', [res.pdf]).catch(() => ({ stdout: '' }));
    const pages = stdout.match(/^Pages:\s+(\d+)/m)?.[1];
    console.log(`✓ unit ${n} compiles${pages ? ` (${pages} pages, build/unit-${n}/unit-${n}.pdf)` : ''}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
  },

  async build(dir) {
    const { lang, level, brand } = await loadJob(dir);
    const plan = await loadPlan(dir);
    const units = [];
    const missing = [];
    for (let n = 1; n <= plan.units.length; n++) {
      const file = path.join(dir, 'units', `unit-${n}.tex`);
      if (!existsSync(file)) { missing.push(n); continue; }
      units.push(parseUnitOutput(await readFile(file, 'utf8')));
    }
    if (missing.length) throw new Error(`missing units: ${missing.map((n) => `units/unit-${n}.tex`).join(', ')}`);
    const source = workbookDocument({ brand, lang, plan, units, levelLabel: levelLabel(lang, level) });
    const res = await compile(source, path.join(dir, 'build'), { name: 'workbook', passes: 2 });
    if (!res.ok) {
      console.log(`✗ the full workbook does not compile:\n${res.errors}`);
      process.exitCode = 1;
      return;
    }
    const { stdout } = await run('pdfinfo', [res.pdf]).catch(() => ({ stdout: '' }));
    console.log(`✓ build/workbook.pdf (${stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? '?'} pages)`);
  },

  async render(dir, args) {
    const unitIdx = args.indexOf('--unit');
    const unit = unitIdx >= 0 ? Number(args[unitIdx + 1]) : null;
    const pages = args.find((a, i) => !a.startsWith('--') && (unitIdx < 0 || i !== unitIdx + 1)) || '1-4';
    const [first, last = first] = pages.split('-').map(Number);
    if (!first || last < first || last - first > 11) throw new Error('usage: wb render <page or range of up to 12 pages, e.g. 3-8> [--unit n]');
    const pdf = unit ? path.join(dir, 'build', `unit-${unit}`, `unit-${unit}.pdf`) : path.join(dir, 'build', 'workbook.pdf');
    if (!existsSync(pdf)) throw new Error(`${path.relative(dir, pdf)} does not exist; run wb ${unit ? `check ${unit}` : 'build'} first`);
    const out = path.join(dir, 'build', 'preview');
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    await run('pdftoppm', ['-r', '60', '-png', '-f', String(first), '-l', String(last), pdf, path.join(out, unit ? `u${unit}-p` : 'p')]);
    const files = (await readdir(out)).sort();
    console.log(files.map((f) => path.join('build/preview', f)).join('\n'));
  },

  async progreso(_dir, args) {
    console.log(`PROGRESO: ${args.join(' ').slice(0, 200)}`);
  },
};

export const AGENT_COMMANDS = Object.keys(commands);

export async function runAgentCommand(name, args, dir = process.cwd()) {
  await commands[name](dir, args);
}


