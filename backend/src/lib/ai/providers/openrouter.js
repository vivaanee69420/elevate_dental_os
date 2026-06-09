// backend/src/lib/ai/providers/openrouter.js
// ============================================================================
// OpenRouter adapter — OpenAI-compatible. Translates the provider contract to
// /chat/completions and back. Phase 1 handles string-content messages; Phase 2
// extends toOpenAIMessage() for tool_result block arrays.
// ============================================================================
import OpenAI from "openai";

function toOpenAIMessage(m) {
  // Phase 1: content is a plain string.
  return { role: m.role, content: m.content };
}

export function createOpenRouterProvider({ model, apiKey = process.env.OPENROUTER_API_KEY } = {}) {
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
  return {
    name: 'openrouter',
    model,
    async chat({ system, messages, tools, maxTokens = 1024, schema } = {}) {
      const oaiMessages = [];
      if (system) oaiMessages.push({ role: 'system', content: system });
      for (const m of messages) oaiMessages.push(toOpenAIMessage(m));
      const req = { model, max_tokens: maxTokens, messages: oaiMessages };
      if (tools) req.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      if (schema) req.response_format = { type: 'json_schema', json_schema: { name: 'structured_output', strict: true, schema } };
      const res = await client.chat.completions.create(req);
      const choice = res.choices[0];
      const toolCalls = (choice.message.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') }));
      return {
        text: choice.message.content || '',
        toolCalls,
        usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        stopReason: choice.finish_reason,
      };
    },
  };
}
