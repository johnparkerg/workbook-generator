import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseLevel, resolveLang, loadBrand, slugify } from '../src/config.js';
import { parseUnitOutput, formatOutput, parseJson, normalizePlan } from '../src/prompts.js';
import { esc, compile, unitTestDocument } from '../src/latex.js';

const fixture = (f) => readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('parseLevel', () => {
  assert.deepEqual(parseLevel('1 of 3'), { level: 1, of: 3 });
  assert.deepEqual(parseLevel('2/3'), { level: 2, of: 3 });
  assert.deepEqual(parseLevel('1 de 3'), { level: 1, of: 3 });
  assert.deepEqual(parseLevel('2'), { level: 2, of: null });
  assert.throws(() => parseLevel('4 of 3'));
  assert.throws(() => parseLevel('basic'));
});

test('resolveLang and brand', () => {
  assert.match(resolveLang('es_MX').babel, /mexico/);
  assert.equal(resolveLang('en-US').labels.Unit, 'Unit');
  assert.throws(() => resolveLang('xx'));
  assert.equal(loadBrand('miss-merab').name, 'Miss Merab');
  assert.equal(loadBrand('Profe Ana').name, 'Profe Ana');
  assert.equal(loadBrand('Profe Ana', { colors: { accent: '#ff0000' } }).colors.accent, '#ff0000');
  assert.throws(() => loadBrand('X', { colors: { accent: 'red' } }));
  assert.equal(slugify('Matemáticas / Fracciones'), 'matematicas-fracciones');
});

test('esc escapes LaTeX specials', () => {
  assert.equal(esc('50% & #1 a_b {x} $'), '50\\% \\& \\#1 a\\_b \\{x\\} \\$');
});

test('parseUnitOutput round-trips and rejects bad output', async () => {
  const unit = { latex: await fixture('unit.tex'), answers: await fixture('answers.tex') };
  const parsed = parseUnitOutput('```latex\n' + formatOutput(unit) + '\n```');
  assert.equal(parsed.latex, unit.latex.trim());
  assert.equal(parsed.answers, unit.answers.trim());
  assert.throws(() => parseUnitOutput('just text'));
  assert.throws(() => parseUnitOutput(formatOutput({ latex: '\\usepackage{x}\\wbunit{a}{b}', answers: 'x' })));
  assert.throws(() => parseUnitOutput(formatOutput({ latex: 'no unit', answers: 'x' })));
});

test('parseJson tolerates fences and prose', () => {
  assert.deepEqual(parseJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
});

const brand = loadBrand('miss-merab');
const lang = resolveLang('es_MX');

test('sample unit compiles', async () => {
  const res = await compile(
    unitTestDocument({ brand, lang, unitNumber: 2, unitLatex: await fixture('unit.tex'), answersLatex: await fixture('answers.tex') }),
    path.join(tmpdir(), 'wb-test-ok'), { name: 'u' });
  assert.equal(res.ok, true, res.errors);
});

test('compile errors point at the offending source line', async () => {
  const broken = (await fixture('unit.tex')).replace('\\section{Partes iguales}', '\\section{Partes iguales}\n$\\frac{1}{2$ roto');
  const res = await compile(unitTestDocument({ brand, lang, unitNumber: 1, unitLatex: broken, answersLatex: '' }),
    path.join(tmpdir(), 'wb-test-bad'), { name: 'u' });
  assert.equal(res.ok, false);
  assert.match(res.errors, /roto/);
});

test('strips model-added numbering from titles', () => {
  const plan = normalizePlan({ units: [{ title: 'Unidad 1: Partes iguales', lessons: [{ title: 'Lección 2: Mitades' }] }] });
  assert.equal(plan.units[0].title, 'Partes iguales');
  assert.equal(plan.units[0].lessons[0].title, 'Mitades');
  const u = parseUnitOutput(formatOutput({ latex: '\\wbunit{Unidad 1: Partes}{x}\n\\section{Lección 1: Repartos}', answers: 'a' }));
  assert.equal(u.latex, '\\wbunit{Partes}{x}\n\\section{Repartos}');
});
