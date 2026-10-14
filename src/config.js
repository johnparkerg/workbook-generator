import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export const DEFAULT_MODEL = 'typesafe/jev-router';

// Textos de interfaz por idioma (los nombres son los sufijos de \wbL<Nombre> en wb.sty).
const LABELS = {
  es: {
    Unit: 'Unidad', KeyIdea: 'Idea clave', Example: 'Ejemplo', Tip: 'Truco',
    Practice: 'Práctica', Review: 'Repaso de la unidad', Answers: 'Respuestas',
    Contents: 'Contenido', Name: 'Nombre', Group: 'Grupo', Level: 'Nivel', Of: 'de',
  },
  en: {
    Unit: 'Unit', KeyIdea: 'Key idea', Example: 'Example', Tip: 'Tip',
    Practice: 'Practice', Review: 'Unit review', Answers: 'Answers',
    Contents: 'Contents', Name: 'Name', Group: 'Class', Level: 'Level', Of: 'of',
  },
  pt: {
    Unit: 'Unidade', KeyIdea: 'Ideia-chave', Example: 'Exemplo', Tip: 'Dica',
    Practice: 'Prática', Review: 'Revisão da unidade', Answers: 'Respostas',
    Contents: 'Sumário', Name: 'Nome', Group: 'Turma', Level: 'Nível', Of: 'de',
  },
};

// Opciones de babel. Sin "shorthands": los atajos del español rompen TikZ.
const BABEL = {
  es_MX: 'spanish,mexico,es-noshorthands,es-noquoting,es-nolists,es-nosectiondot',
  es: 'spanish,es-noshorthands,es-noquoting,es-nolists,es-nosectiondot',
  en_US: 'american', en_GB: 'british', en: 'english',
  pt_BR: 'brazilian', pt: 'portuguese',
};

const NAMES = { es: 'Spanish', en: 'English', pt: 'Portuguese' };

export function resolveLang(code = 'es_MX') {
  const norm = code.replace('-', '_');
  const base = norm.split('_')[0].toLowerCase();
  if (!LABELS[base]) {
    throw new Error(`Unsupported language "${code}". Supported: ${Object.keys(BABEL).join(', ')}`);
  }
  return {
    code: norm,
    name: `${NAMES[base]} (${norm})`,
    babel: BABEL[norm] || BABEL[base],
    labels: LABELS[base],
  };
}

/** "1 of 3", "1/3", "1 de 3" o "1" → { level, of } */
export function parseLevel(text = '1') {
  const m = String(text).trim().match(/^(\d+)\s*(?:\/|of|de|sur)?\s*(\d+)?$/i);
  if (!m) throw new Error(`Can't read level "${text}". Use e.g. "1 of 3" or "1/3".`);
  const level = Number(m[1]);
  const of = m[2] ? Number(m[2]) : null;
  if (of && level > of) throw new Error(`Level ${level} is beyond ${of}.`);
  return { level, of };
}

const DEFAULT_COLORS = { primary: '#14284D', secondary: '#4A5B7A', accent: '#F2B73B', paper: '#EEF1F6' };

/**
 * --brand puede ser un archivo JSON, el nombre de uno en brands/ (p.ej. "miss-merab"),
 * o simplemente el nombre a imprimir ("Miss Merab").
 */
export function loadBrand(arg = 'Miss Merab', overrides = {}) {
  const slug = slugify(arg);
  const candidates = [arg, path.join(ROOT, 'brands', `${slug}.json`)];
  let brand = { name: arg };
  for (const file of candidates) {
    if (file.endsWith('.json') && existsSync(file)) {
      brand = JSON.parse(readFileSync(file, 'utf8'));
      if (brand.logo) brand.logo = path.resolve(path.dirname(file), brand.logo);
      break;
    }
  }
  brand.colors = { ...DEFAULT_COLORS, ...brand.colors, ...overrides.colors };
  if (overrides.logo) brand.logo = path.resolve(overrides.logo);
  if (brand.logo && !existsSync(brand.logo)) throw new Error(`Logo not found: ${brand.logo}`);
  for (const [k, v] of Object.entries(brand.colors)) {
    if (!/^#?[0-9a-f]{6}$/i.test(v)) throw new Error(`Color ${k} must be a 6-digit hex like #14284D (got "${v}")`);
  }
  return brand;
}

export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
