// backend/src/lib/ai/providers/gemini.js
// ============================================================================
// Gemini adapter — implements the provider contract over Gemini REST API.
// ============================================================================

export function createGeminiProvider({ model = 'gemini-2.5-flash', apiKey = process.env.GEMINI_API_KEY } = {}) {
  return {
    name: 'gemini',
    model,
    async chat({ system, messages, tools, maxTokens = 1024, schema } = {}) {
      if (!apiKey) {
        throw new Error("Missing GEMINI_API_KEY");
      }

      // Map roles: assistant -> model, others stay user
      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const payload = {
        contents,
      };

      if (system) {
        payload.systemInstruction = {
          parts: [{ text: system }],
        };
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

      // Direct REST call using native fetch
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const resObj = await response.json();
      const candidate = resObj.candidates?.[0];
      let text = candidate?.content?.parts?.[0]?.text || '';
      if (text.trim().startsWith('```')) {
        text = text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      }
      const stopReason = candidate?.finishReason || 'STOP';
      const inputTokens = resObj.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = resObj.usageMetadata?.candidatesTokenCount ?? 0;

      return {
        text,
        toolCalls: [],
        usage: { inputTokens, outputTokens },
        stopReason,
      };
    },
  };
}

function cleanSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(cleanSchema);
  }
  const cleaned = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') {
      continue;
    }
    cleaned[key] = cleanSchema(value);
  }
  return cleaned;
}

