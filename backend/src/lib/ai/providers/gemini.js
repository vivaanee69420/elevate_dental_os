// backend/src/lib/ai/providers/gemini.js
// ============================================================================
// Gemini adapter — implements the provider contract over Gemini REST API.
// Supports automatic retry with exponential back-off on 429 / 503.
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_STATUSES = new Set([429, 503]);

// Parse a JSON string into an object for a functionResponse; non-objects are
// wrapped so Gemini always receives an object response.
function asResponseObject(content) {
  if (content && typeof content === 'object') return content;
  try {
    const parsed = JSON.parse(String(content ?? ''));
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : { result: parsed };
  } catch {
    return { result: String(content ?? '') };
  }
}

// Map one normalized message to a Gemini `contents` entry. String content is the
// Phase 1 path; an array carries text / tool_use / tool_result blocks.
function toGeminiContent(m) {
  const role = m.role === 'assistant' ? 'model' : 'user';
  if (!Array.isArray(m.content)) return { role, parts: [{ text: m.content }] };
  const parts = m.content.map((b) => {
    if (b.type === 'tool_use') return { functionCall: { name: b.name, args: b.input ?? {} } };
    // name is guaranteed by the normalized block contract — the tool-loop runner always sets it.
    if (b.type === 'tool_result') return { functionResponse: { name: b.name, response: asResponseObject(b.content) } };
    return { text: b.text || '' };
  });
  return { role, parts };
}

export function createGeminiProvider({ model = 'gemini-2.5-flash-lite', apiKey = process.env.GEMINI_API_KEY } = {}) {
  return {
    name: 'gemini',
    model,
    async chat({ system, messages, tools, maxTokens = 1024, schema } = {}) {
      if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY');
      }

      // Map roles: assistant -> model, others stay user; array content carries tool blocks
      const contents = messages.map(toGeminiContent);

      const payload = { contents };

      if (system) {
        payload.systemInstruction = { parts: [{ text: system }] };
      }

      if (tools && tools.length) {
        payload.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: cleanSchema(t.inputSchema) })) }];
      }

      const generationConfig = {};
      if (maxTokens) {
        generationConfig.maxOutputTokens = maxTokens;
      }
      if (schema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = cleanSchema(schema);
      }
      if (Object.keys(generationConfig).length > 0) {
        payload.generationConfig = generationConfig;
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      // --- Retry loop with exponential back-off ---
      let lastError;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = 1000 * 2 ** (attempt - 1); // 1s, 2s
          console.warn(`[gemini] retry ${attempt}/${MAX_RETRIES - 1} after ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          lastError = new Error(`Gemini API error (${response.status}): ${errorText}`);
          if (RETRY_STATUSES.has(response.status)) {
            continue; // retry
          }
          throw lastError; // non-retryable (400, 401, etc.)
        }

        const resObj = await response.json();
        const candidate = resObj.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        let text = '';
        const toolCalls = [];
        for (const part of parts) {
          if (typeof part.text === 'string') text += part.text;
          if (part.functionCall) {
            toolCalls.push({ id: `gem_${toolCalls.length}_${part.functionCall.name}`, name: part.functionCall.name, input: part.functionCall.args ?? {} });
          }
        }
        if (!toolCalls.length && text.trim().startsWith('```')) {
          text = text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        }
        const stopReason = toolCalls.length ? 'tool_use' : (candidate?.finishReason || 'STOP');
        const inputTokens = resObj.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = resObj.usageMetadata?.candidatesTokenCount ?? 0;
        return { text, toolCalls, usage: { inputTokens, outputTokens }, stopReason };
      }

      throw lastError ?? new Error('Gemini: max retries exceeded');
    },
  };
}

function cleanSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  const cleaned = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    cleaned[key] = cleanSchema(value);
  }
  return cleaned;
}
