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
        generationConfig.responseSchema = schema;
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
      const text = candidate?.content?.parts?.[0]?.text || '';
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
