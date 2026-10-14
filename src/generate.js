import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chat, usage } from './openrouter.js';
import { planMessages, unitMessages, reviewMessages, fixMessages, parseUnitOutput, formatOutput, parseJson, normalizePlan } from './prompts.js';
import { compile, unitTestDocument, workbookDocument } from './latex.js';

const MAX_FIXES = 3;

const log = (...a) => console.log(...a);

export async function generate(opts) {
  const { runDir, model } = opts;
  await mkdir(path.join(runDir, 'units'), { recursive: true });
  log(`Workbook: ${opts.subject} · level ${opts.level.level}${opts.level.of ? `/${opts.level.of}` : ''} · ${opts.lang.code} · ${opts.brand.name}`);
  log(`Model: ${model}`);
  log(`Output: ${runDir}\n`);

  const plan = await getPlan(opts);
  printPlan(plan);
  if (opts.planOnly) {
    log(`\nPlan saved to ${path.join(runDir, 'plan.json')} — edit it if you like, then run again without --plan-only.`);
    return null;
  }

  const units = new Array(plan.units.length);
  const queue = plan.units.map((_, i) => i);
  const workers = Array.from({ length: Math.min(opts.concurrency, queue.length) }, async () => {
    while (queue.length) {
      const i = queue.shift();
      units[i] = await getUnit(opts, plan, i);
    }
  });
  await Promise.all(workers);

  log('\nCompiling workbook…');
  const levelLabel = `${opts.lang.labels.Level} ${opts.level.level}${opts.level.of ? ` ${opts.lang.labels.Of} ${opts.level.of}` : ''}`;
  const source = workbookDocument({ brand: opts.brand, lang: opts.lang, plan, units, levelLabel });
  const res = await compile(source, path.join(runDir, 'build'), { name: 'workbook', passes: 2 });
  if (!res.ok) throw new Error(`Final compile failed:\n${res.errors}`);
  const finalPdf = path.join(runDir, `${path.basename(runDir)}.pdf`);
  await copyFile(res.pdf, finalPdf);
  await writeFile(path.join(runDir, 'workbook.tex'), source);

  log(`\n✓ ${finalPdf}`);
  if (usage.calls) {
    log(`  ${usage.calls} model calls · ${usage.promptTokens.toLocaleString()} in / ${usage.completionTokens.toLocaleString()} out tokens` +
      (usage.cost ? ` · $${usage.cost.toFixed(4)}` : ''));
  }
  return finalPdf;
}

async function getPlan(opts) {
  const file = path.join(opts.runDir, 'plan.json');
  if (existsSync(file) && !opts.force) {
    log('Plan: using saved plan.json');
    return normalizePlan(JSON.parse(await readFile(file, 'utf8')));
  }
  log('Plan: asking the model for an outline…');
  let plan;
  for (let attempt = 1; ; attempt++) {
    const text = await chat({ model: opts.model, messages: planMessages(opts), maxTokens: 8000, label: 'plan' });
    try {
      plan = normalizePlan(parseJson(text));
      if (!Array.isArray(plan.units) || !plan.units.length) throw new Error('plan has no units');
      break;
    } catch (err) {
      if (attempt === 3) throw new Error(`Could not get a valid plan: ${err.message}`);
      log(`  plan was not valid JSON (${err.message}), retrying…`);
    }
  }
  if (plan.units.length !== opts.units) log(`  note: model planned ${plan.units.length} units (asked for ${opts.units})`);
  await writeFile(file, JSON.stringify(plan, null, 2));
  return plan;
}

function printPlan(plan) {
  log(`\n  ${plan.title} — ${plan.subtitle}`);
  if (plan.audience) log(`  Audience: ${plan.audience.age} · ${plan.audience.grade}`);
  plan.units.forEach((u, i) => {
    log(`  ${i + 1}. ${u.title}`);
    (u.lessons || []).forEach((l, j) => log(`       ${i + 1}.${j + 1} ${l.title}`));
  });
}

async function getUnit(opts, plan, i) {
  const n = i + 1;
  const file = path.join(opts.runDir, 'units', `unit-${n}.tex`);
  const tag = `unit ${n}`;
  if (existsSync(file) && !opts.force && !opts.redo.includes(n)) {
    log(`[${tag}] using saved ${path.relative(opts.runDir, file)}`);
    return parseUnitOutput(await readFile(file, 'utf8'));
  }

  // El borrador se guarda antes de la revisión: si algo falla después, no se pierde la escritura.
  const draftFile = path.join(opts.runDir, 'units', `unit-${n}.draft.tex`);
  let unit;
  if (existsSync(draftFile) && !opts.force && !opts.redo.includes(n)) {
    log(`[${tag}] resuming from saved draft`);
    unit = parseUnitOutput(await readFile(draftFile, 'utf8'));
  } else {
    log(`[${tag}] writing “${plan.units[i].title}”…`);
    unit = await askForUnit(opts, unitMessages({ ...opts, plan, index: i }), tag);
    await writeFile(draftFile, formatOutput(unit));
  }

  if (opts.review) {
    log(`[${tag}] reviewing math and answer key…`);
    try {
      const text = await chat({ model: opts.model, messages: reviewMessages({ output: formatOutput(unit), lang: opts.lang, plan }), maxTokens: opts.maxTokens, label: `${tag} review` });
      if (/^\s*NO_CHANGES\s*$/.test(text)) {
        log(`[${tag}] review: no changes`);
      } else {
        unit = parseUnitOutput(text);
        log(`[${tag}] review: corrections applied`);
      }
    } catch (err) {
      log(`[${tag}] review failed (${err.message.split('\n')[0]}); keeping the draft`);
    }
  }

  // Compila la unidad sola; si falla, le pasamos el error al modelo para que lo arregle.
  const buildDir = path.join(opts.runDir, 'build', `unit-${n}`);
  for (let attempt = 0; ; attempt++) {
    const res = await compile(unitTestDocument({ brand: opts.brand, lang: opts.lang, unitNumber: n, unitLatex: unit.latex, answersLatex: unit.answers }), buildDir, { name: `unit-${n}`, passes: 2 });
    if (res.ok) break;
    if (attempt === MAX_FIXES) {
      await writeFile(path.join(opts.runDir, 'units', `unit-${n}.failed.tex`), formatOutput(unit));
      throw new Error(`[${tag}] still fails to compile after ${MAX_FIXES} fixes. Last errors:\n${res.errors}`);
    }
    log(`[${tag}] LaTeX error, asking the model to fix it (${attempt + 1}/${MAX_FIXES}): ${res.errors.split('\n')[0]}`);
    unit = await askForUnit(opts, fixMessages({ output: formatOutput(unit), errors: res.errors }), `${tag} fix`);
  }

  await writeFile(file, formatOutput(unit));  // el borrador se queda, para comparar lo que cambió la revisión
  log(`[${tag}] ✓ compiled and saved`);
  return unit;
}

async function askForUnit(opts, messages, label) {
  for (let attempt = 1; ; attempt++) {
    const text = await chat({ model: opts.model, messages, maxTokens: opts.maxTokens, label });
    try {
      return parseUnitOutput(text);
    } catch (err) {
      if (attempt === 3) throw new Error(`[${label}] ${err.message}`);
      log(`  [${label}] ${err.message}; asking again…`);
    }
  }
}
