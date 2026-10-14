import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chat, usage } from './openrouter.js';
import { planMessages, revisePlanMessages, unitMessages, reviewMessages, fixMessages, reviseMessages, parseUnitOutput, formatOutput, parseJson, normalizePlan } from './prompts.js';
import { compile, unitTestDocument, workbookDocument } from './latex.js';
import { digestSources } from './sources.js';
import { visualCheck, issuesAsFeedback } from './visual.js';

const MAX_FIXES = 3;

const log = (...a) => console.log(...a);

export async function generate(opts) {
  const { runDir, model } = opts;
  await mkdir(path.join(runDir, 'units'), { recursive: true });
  log(`Workbook: ${opts.subject} · level ${opts.level.level}${opts.level.of ? `/${opts.level.of}` : ''} · ${opts.lang.code} · ${opts.brand.name}`);
  log(`Model: ${model}`);
  log(`Output: ${runDir}\n`);

  opts.sources = await digestSources(opts.sourceFiles || [], { runDir, model, force: opts.force, log });
  const plan = await getPlan(opts);
  printPlan(plan);
  if (opts.planOnly) {
    log(`\nPlan saved to ${path.join(runDir, 'plan.json')} — edit it if you like, then run again without --plan-only.`);
    logUsage();
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
  logUsage();
  return finalPdf;
}

function logUsage() {
  if (!usage.calls) return;
  log(`  ${usage.calls} model calls · ${usage.promptTokens.toLocaleString()} in / ${usage.completionTokens.toLocaleString()} out tokens` +
    (usage.cost ? ` · $${usage.cost.toFixed(4)}` : ''));
}

async function getPlan(opts) {
  const file = path.join(opts.runDir, 'plan.json');
  let messages = planMessages(opts);
  if (existsSync(file) && !opts.force) {
    const saved = normalizePlan(JSON.parse(await readFile(file, 'utf8')));
    if (!opts.planFeedback) {
      log('Plan: using saved plan.json');
      return saved;
    }
    log(`Plan: revising the outline: “${opts.planFeedback}”`);
    messages = revisePlanMessages({ ...opts, plan: saved, feedback: opts.planFeedback });
  } else {
    log('Plan: asking the model for an outline…');
  }
  let plan;
  for (let attempt = 1; ; attempt++) {
    const text = await chat({ model: opts.model, messages, maxTokens: 16000, label: 'plan' });
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
  const feedback = opts.revise?.[n];
  if (existsSync(file) && feedback) return reviseUnit(opts, plan, i, file, feedback);
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
      // Esfuerzo de razonamiento acotado: sin tope, el router llegó a pensar 10 minutos en esta revisión.
      const text = await chat({ model: opts.model, messages: reviewMessages({ output: formatOutput(unit), lang: opts.lang, plan }), maxTokens: opts.maxTokens, maxTokensCap: 64000, reasoning: { effort: 'medium' }, label: `${tag} review` });
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

  unit = await compileChecked(opts, n, unit);
  unit = await lookAndFix(opts, plan, i, unit);
  await writeFile(file, formatOutput(unit));  // el borrador se queda, para comparar lo que cambió la revisión
  log(`[${tag}] ✓ compiled and saved`);
  return unit;
}

/** Mira las páginas renderizadas; si hay defectos, una sola corrección dirigida y se recompila. */
async function lookAndFix(opts, plan, i, unit) {
  if (!opts.visualCheck) return unit;
  const n = i + 1;
  const tag = `unit ${n}`;
  log(`[${tag}] looking at the pages…`);
  let issues;
  try {
    issues = await visualCheck({ pdf: path.join(opts.runDir, 'build', `unit-${n}`, `unit-${n}.pdf`), lang: opts.lang, model: opts.checkModel || opts.model, label: tag });
  } catch (err) {
    log(`[${tag}] visual check failed (${err.message.split('\n')[0]}); keeping the unit`);
    return unit;
  }
  if (!issues.length) {
    log(`[${tag}] visual check: no issues`);
    return unit;
  }
  log(`[${tag}] visual check: ${issues.length} issue(s), fixing`);
  for (const x of issues) log(`    p.${x.page}: ${x.problem}`);
  try {
    const fixed = await askForUnit(opts, reviseMessages({ output: formatOutput(unit), feedback: issuesAsFeedback(issues), lang: opts.lang, plan, index: i }), `${tag} visual fix`);
    return await compileChecked(opts, n, fixed);
  } catch (err) {
    log(`[${tag}] visual fix failed (${err.message.split('\n')[0]}); keeping the unit`);
    return unit;
  }
}

/** Reescribe una unidad ya guardada según la retroalimentación del maestro. */
async function reviseUnit(opts, plan, i, file, feedback) {
  const n = i + 1;
  const tag = `unit ${n}`;
  const current = await readFile(file, 'utf8');
  await writeFile(path.join(opts.runDir, 'units', `unit-${n}.before-revision.tex`), current);
  log(`[${tag}] revising: “${feedback}”`);
  let unit = await askForUnit(opts, reviseMessages({ output: current, feedback, lang: opts.lang, plan, index: i, sources: opts.sources }), `${tag} revise`);
  unit = await compileChecked(opts, n, unit);
  unit = await lookAndFix(opts, plan, i, unit);
  await writeFile(file, formatOutput(unit));
  log(`[${tag}] ✓ revised and saved`);
  return unit;
}

// Compila la unidad sola; si falla, le pasamos el error al modelo para que lo arregle.
async function compileChecked(opts, n, unit) {
  const tag = `unit ${n}`;
  const buildDir = path.join(opts.runDir, 'build', `unit-${n}`);
  for (let attempt = 0; ; attempt++) {
    const res = await compile(unitTestDocument({ brand: opts.brand, lang: opts.lang, unitNumber: n, unitLatex: unit.latex, answersLatex: unit.answers }), buildDir, { name: `unit-${n}`, passes: 2 });
    if (res.ok) return unit;
    if (res.environment) throw new Error(`[${tag}] LaTeX could not run (environment problem, not the unit):\n${res.errors}`);
    if (attempt === MAX_FIXES) {
      await writeFile(path.join(opts.runDir, 'units', `unit-${n}.failed.tex`), formatOutput(unit));
      throw new Error(`[${tag}] still fails to compile after ${MAX_FIXES} fixes. Last errors:\n${res.errors}`);
    }
    log(`[${tag}] LaTeX error, asking the model to fix it (${attempt + 1}/${MAX_FIXES}): ${res.errors.split('\n')[0]}`);
    unit = await askForUnit(opts, fixMessages({ output: formatOutput(unit), errors: res.errors }), `${tag} fix`);
  }
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
