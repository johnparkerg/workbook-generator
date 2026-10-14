#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { ROOT, DEFAULT_MODEL, loadEnv, resolveLang, parseLevel, loadBrand, slugify } from './config.js';
import { generate } from './generate.js';
import { AGENT_COMMANDS, runAgentCommand } from './agent.js';

// Modo agente: `node src/cli.js check 2` etc., desde la carpeta de trabajo (ver src/agent.js).
if (AGENT_COMMANDS.includes(process.argv[2])) {
  try {
    await runAgentCommand(process.argv[2], process.argv.slice(3));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
  process.exit();
}

const HELP = `Workbook Generator — subject + level → branded LaTeX/PDF workbook

Usage:
  node src/cli.js --subject "Matemáticas / Fracciones" --level "1 of 3" --lang es_MX --brand miss-merab

Options:
  --subject <text>     Subject and topic (required)
  --level <n[/m]>      Level, e.g. "1 of 3", "1/3" or "2"            (default: 1)
  --lang <code>        es_MX, es, en_US, en_GB, pt_BR, pt            (default: es_MX)
  --brand <name|json>  Name to print, or brands/<slug>.json, or a path to a brand JSON
                                                                     (default: Miss Merab)
  --logo <file>        Logo image (PNG/PDF/JPG) for the cover
  --primary, --secondary, --accent, --paper <#hex>   Override brand colours
  --units <n>          Number of units                               (default: 4)
  --audience <text>    Age/grade, e.g. "3.º de primaria" (default: inferred by the model)
  --notes <text>       Extra instructions for the author model
  --source <file>      Teacher material to base the book on: PDF or image (repeatable)
  --model <id>         OpenRouter model (default: $OPENROUTER_MODEL or ${DEFAULT_MODEL})
  --max-tokens <n>     Starting output-token budget per call (doubles if cut off; default 32000)
  --concurrency <n>    Units written in parallel                     (default: 2)
  --no-review          Skip the math/answer-key review pass
  --out <dir>          Output folder (default: output/<subject>-<level>-<lang>)
  --plan-only          Only create plan.json, to review/edit it before writing units
  --plan-feedback <text>  Revise the saved plan.json following teacher feedback
  --redo <list>        Rewrite these units from scratch, e.g. --redo 2,4
  --revise "<n>: <feedback>"   Revise a saved unit following teacher feedback
                       (repeatable), e.g. --revise "2: más ejemplos con dinero"
  --force              Ignore everything saved and start over
  -h, --help

Re-running with the same options reuses the saved plan and units, so you can
edit output/.../plan.json or units/unit-N.tex by hand and just rebuild.

Agent mode (run inside a folder with workbook.json; see agent/CLAUDE.md):
  node src/cli.js guide | sources | check <n> | build | render <pages> [--unit n] | progreso "<text>"`;

const { values: v } = parseArgs({
  allowNegative: true,
  options: {
    subject: { type: 'string' }, level: { type: 'string', default: '1' },
    lang: { type: 'string', default: 'es_MX' }, brand: { type: 'string', default: 'Miss Merab' },
    logo: { type: 'string' }, primary: { type: 'string' }, secondary: { type: 'string' },
    accent: { type: 'string' }, paper: { type: 'string' },
    units: { type: 'string', default: '4' }, audience: { type: 'string' }, notes: { type: 'string' }, source: { type: 'string', multiple: true, default: [] },
    model: { type: 'string' }, 'max-tokens': { type: 'string', default: '32000' },
    concurrency: { type: 'string', default: '2' }, review: { type: 'boolean', default: true },
    out: { type: 'string' }, 'plan-only': { type: 'boolean' }, 'plan-feedback': { type: 'string' }, redo: { type: 'string', default: '' },
    revise: { type: 'string', multiple: true, default: [] },
    force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});

if (v.help || !v.subject) {
  console.log(HELP);
  process.exit(v.help ? 0 : 1);
}

function parseRevise(list) {
  const out = {};
  for (const item of list) {
    const m = item.match(/^\s*(\d+)\s*[:=]\s*([\s\S]+)$/);
    if (!m) throw new Error(`--revise must look like "2: make it easier" (got "${item}")`);
    out[Number(m[1])] = m[2].trim();
  }
  return out;
}

try {
  loadEnv();
  const level = parseLevel(v.level);
  const lang = resolveLang(v.lang);
  const colors = Object.fromEntries(['primary', 'secondary', 'accent', 'paper'].filter((k) => v[k]).map((k) => [k, v[k]]));
  const brand = loadBrand(v.brand, { colors, logo: v.logo });
  const units = Number(v.units);
  if (!Number.isInteger(units) || units < 1 || units > 12) throw new Error('--units must be between 1 and 12');
  const slug = `${slugify(v.subject)}-${level.level}${level.of ? `de${level.of}` : ''}-${slugify(lang.code)}`;

  await generate({
    subject: v.subject, level, lang, brand, units,
    audience: v.audience, notes: v.notes,
    sourceFiles: v.source.map((f) => path.resolve(f)),
    model: v.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    maxTokens: Number(v['max-tokens']),
    concurrency: Math.max(1, Number(v.concurrency)),
    review: v.review,
    runDir: path.resolve(v.out || path.join(ROOT, 'output', slug)),
    planOnly: v['plan-only'],
    planFeedback: v['plan-feedback'],
    redo: v.redo.split(',').filter(Boolean).map(Number),
    revise: parseRevise(v.revise),
    force: v.force,
  });
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
}
