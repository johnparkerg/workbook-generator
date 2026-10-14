#!/usr/bin/env node
// Corre Claude Code (headless) como autor del cuadernillo en una carpeta de trabajo, usando un
// modelo de OpenRouter (por defecto typesafe/jev-router). Imprime eventos JSON, uno por línea:
//   {"type":"progreso","texto":"Escribiendo la unidad 2 de 4…"}   (de `wb progreso`)
//   {"type":"herramienta","texto":"Write units/unit-2.tex"}
//   {"type":"fin","ok":true,"turnos":42,"costo":0.81,"sesion":"…","resultado":"…"}
//
//   node agent/run.mjs <carpeta> --phase plan|book|revise [--model id] [--max-turns n]
//
// Necesita OPENROUTER_API_KEY. La carpeta debe tener workbook.json (ver agent/CLAUDE.md).

import { spawn } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS = {
  plan: 'Phase: plan. Follow CLAUDE.md, section "Phase plan". Write plan.json and stop.',
  book: 'Phase: book. Follow CLAUDE.md, section "Phase book": write every missing unit, check, review, look at the drawings, then wb build.',
  revise: 'Phase: revise. Follow CLAUDE.md, section "Phase revise", for every entry in workbook.json "revisions", then wb build.',
};

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    phase: { type: 'string' },
    model: { type: 'string', default: process.env.OPENROUTER_MODEL || 'typesafe/jev-router' },
    'max-turns': { type: 'string', default: '250' },
  },
});
const dir = path.resolve(positionals[0] || '.');
if (!PROMPTS[v.phase]) throw new Error('--phase must be plan, book or revise');
if (!existsSync(path.join(dir, 'workbook.json'))) throw new Error(`no workbook.json in ${dir}`);
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY is missing');

const emit = (o) => console.log(JSON.stringify(o));

// Lo que se gasta: el uso de la llave en OpenRouter antes y después (el costo que reporta
// Claude Code usa precios de Anthropic y no aplica aquí).
async function keyUsage() {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } });
    return (await r.json()).data?.usage ?? null;
  } catch {
    return null;
  }
}

await copyFile(path.join(ROOT, 'agent', 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
const before = await keyUsage();

const m = v.model;
const env = {
  ...process.env,
  PATH: `${path.join(ROOT, 'bin')}:${process.env.PATH}`,
  ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
  ANTHROPIC_AUTH_TOKEN: key,
  ANTHROPIC_API_KEY: '', // vacío para que Claude Code use el token de arriba
  ANTHROPIC_MODEL: m,
  ANTHROPIC_DEFAULT_OPUS_MODEL: m,
  ANTHROPIC_DEFAULT_SONNET_MODEL: m,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: m,
  ANTHROPIC_SMALL_FAST_MODEL: m,
  CLAUDE_CODE_SUBAGENT_MODEL: m,
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', // los comandos de Bash no ven las credenciales
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
};
delete env.CLAUDE_CODE_OAUTH_TOKEN;
delete env.OPENROUTER_API_KEY;

const args = [
  '-p', PROMPTS[v.phase],
  '--output-format', 'stream-json', '--verbose',
  '--model', m,
  '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Bash Read Write Edit MultiEdit Glob Grep TodoWrite',
  '--disallowedTools', 'WebFetch WebSearch Task Agent',
  '--setting-sources', 'project', // sólo el CLAUDE.md de la carpeta; nada de la config del usuario
  '--strict-mcp-config',
  '--max-turns', v['max-turns'],
];

const log = path.join(dir, 'claude.jsonl');
let final = null;
const code = await new Promise((resolve) => {
  const p = spawn('claude', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      appendFileSync(log, line + '\n');
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type !== 'tool_use') continue;
          const input = block.input || {};
          const cmd = input.command || '';
          const pm = cmd.match(/wb progreso\s+["']([^"']+)["']/);
          if (pm) emit({ type: 'progreso', texto: pm[1] });
          else {
            const detalle = input.file_path ? path.relative(dir, input.file_path) : cmd || input.pattern || '';
            emit({ type: 'herramienta', texto: `${block.name} ${String(detalle).slice(0, 120)}`.trim() });
          }
        }
      } else if (msg.type === 'result') {
        final = msg;
      }
    }
  });
  p.stderr.on('data', (d) => process.stderr.write(d));
  p.on('close', resolve);
});

const after = await keyUsage();
emit({
  type: 'fin',
  ok: code === 0 && final?.subtype === 'success' && !final?.is_error,
  turnos: final?.num_turns ?? null,
  costo: before != null && after != null ? Math.max(0, after - before) : null,
  sesion: final?.session_id ?? null,
  resultado: String(final?.result ?? '').slice(0, 2000),
});
process.exitCode = code === 0 ? 0 : 1;
