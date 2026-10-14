// Proveedor directo de Anthropic (modelos claude-*), con el SDK oficial. Recibe los mismos mensajes
// estilo OpenAI que usa el resto del generador ({role, content}, imágenes como image_url data:) y
// los traduce al formato de la Messages API.

import Anthropic from '@anthropic-ai/sdk';

// Dólares por millón de tokens: entrada, salida, lectura de caché, escritura de caché.
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-opus-4-8': [5, 25, 0.5, 6.25],
  'claude-fable-5-1': [10, 50, 0.25, 12.5],
};
// Modelos que aceptan el respaldo del lado del servidor ("default") si el modelo declina.
const WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);

let client;
const getClient = () => (client ??= new Anthropic({ maxRetries: 4 }));

export const isAnthropicModel = (model) => /^claude-/.test(model);

function toBlocks(content) {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image_url') {
      const m = part.image_url.url.match(/^data:([^;]+);base64,(.*)$/s);
      if (!m) throw new Error('Only base64 data: images are supported');
      return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    }
    throw new Error(`Unsupported content part: ${part.type}`);
  });
}

export function costOf(model, usage) {
  const [inp, out, read, write] = PRICES[model] || PRICES['claude-opus-5'];
  return ((usage.input_tokens || 0) * inp + (usage.output_tokens || 0) * out
    + (usage.cache_read_input_tokens || 0) * read + (usage.cache_creation_input_tokens || 0) * write) / 1e6;
}

/**
 * Una llamada. Devuelve { text, stopReason, model, usage }.
 * stopReason 'max_tokens' significa que se cortó (el que llama decide si reintenta con más espacio).
 */
export async function anthropicCall({ model, messages, maxTokens, effort }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const params = {
    model,
    max_tokens: maxTokens,
    // Las instrucciones largas (pedagogía, LaTeX permitido, formato) se repiten en cada unidad: caché.
    ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
    messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: toBlocks(m.content) })),
    ...(effort ? { output_config: { effort } } : {}),
  };
  if (WITH_FALLBACK.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const message = await getClient().beta.messages.stream(params).finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error(`Claude declined the request (${message.stop_details?.category ?? 'no category'})`);
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, stopReason: message.stop_reason, model: message.model, usage: message.usage };
}
