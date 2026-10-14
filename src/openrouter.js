const URL = 'https://openrouter.ai/api/v1/chat/completions';

export const usage = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 };

// Los modelos con razonamiento gastan tokens de salida pensando; si la respuesta se corta,
// se reintenta con el doble de presupuesto hasta este tope.
const MAX_TOKENS_CAP = 128000;

/**
 * Una llamada de chat a OpenRouter. Reintenta en 429/5xx y fallas de red.
 * Devuelve el texto de la respuesta.
 */
export async function chat({ model, messages, maxTokens = 32000, temperature = 0.4, label = 'llm' }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is missing. Add it to workbook-generator/.env');

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const body = JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, usage: { include: true } });
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Workbook Generator',
        },
        body,
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`), { retry: true });
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 500)}`);
      const data = JSON.parse(text);
      if (data.error) throw Object.assign(new Error(`OpenRouter error: ${JSON.stringify(data.error).slice(0, 500)}`), { retry: true });
      usage.calls++;
      usage.promptTokens += data.usage?.prompt_tokens || 0;
      usage.completionTokens += data.usage?.completion_tokens || 0;
      usage.cost += data.usage?.cost || 0;
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (choice?.finish_reason === 'length') {
        lastErr = new Error(`response cut off at max_tokens=${maxTokens}`);
        if (maxTokens >= MAX_TOKENS_CAP) break;
        console.warn(`  [${label}] response cut off at ${maxTokens} tokens — retrying with ${Math.min(maxTokens * 2, MAX_TOKENS_CAP)}`);
        maxTokens = Math.min(maxTokens * 2, MAX_TOKENS_CAP);
        continue;
      }
      if (!content) throw Object.assign(new Error(`Empty response (finish_reason=${choice?.finish_reason})`), { retry: true });
      return content;
    } catch (err) {
      lastErr = err;
      const retriable = err.retry || err.name === 'TimeoutError' || err.cause?.code;
      if (!retriable || attempt === 4) break;
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`  [${label}] ${err.message.split('\n')[0]} — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
