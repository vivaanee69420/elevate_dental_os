// backend/src/lib/ai/providers/openrouter.js
// ============================================================================
// OpenRouter adapter — OpenAI-compatible. Translates the provider contract to
// /chat/completions and back. Phase 1 handles string-content messages; Phase 2
// extends toOpenAIMessages() for tool_result block arrays.
// ============================================================================
import OpenAI from "openai";

// Normalized message -> OpenAI chat message(s). String content is the Phase 1
// path. An assistant tool_use block array becomes one assistant message carrying
// `tool_calls`; a tool_result block array becomes one `role:'tool'` message per
// result.
function toOpenAIMessages(m) {
  if (!Array.isArray(m.content)) return [{ role: m.role, content: m.content }];
  if (m.role === 'assistant') {
    const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const tool_calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
    return [{ role: 'assistant', content: text || null, ...(tool_calls.length ? { tool_calls } : {}) }];
  }
  return m.content.filter((b) => b.type === 'tool_result').map((b) => ({ role: 'tool', tool_call_id: b.toolUseId, content: b.content }));
}

export function createOpenRouterProvider({ model, apiKey = process.env.OPENROUTER_API_KEY } = {}) {
  return {
    name: 'openrouter',
    model,
    async chat({ system, messages, tools, maxTokens = 1024, schema } = {}) {
      if (!apiKey) {
        throw new Error('No OPENROUTER_API_KEY');
      }
      const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
      const oaiMessages = [];
      if (system) oaiMessages.push({ role: 'system', content: system });
      for (const m of messages) oaiMessages.push(...toOpenAIMessages(m));
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
