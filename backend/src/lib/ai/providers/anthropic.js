// backend/src/lib/ai/providers/anthropic.js
// ============================================================================
// Anthropic adapter — implements the provider contract over @anthropic-ai/sdk.
// ============================================================================
import Anthropic from "@anthropic-ai/sdk";

// Translate one normalized message to the Anthropic SDK message shape. String
// content passes through; block arrays map tool_use/tool_result/text.
function toAnthropicMessage(m) {
  if (!Array.isArray(m.content)) return { role: m.role, content: m.content };
  const content = m.content.map((b) => {
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} };
    if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content };
    return { type: 'text', text: b.text || '' };
  });
  return { role: m.role, content };
}

export function createAnthropicProvider({ model, apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  return {
    name: 'anthropic',
    model,
    async chat({ system, messages, tools, maxTokens = 1024, schema } = {}) {
      if (!apiKey) {
        throw new Error('No ANTHROPIC_API_KEY');
      }
      const client = new Anthropic({ apiKey });
      const req = { model, max_tokens: maxTokens, messages: messages.map(toAnthropicMessage) };
      if (system) req.system = system;
      if (tools) req.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      if (schema) req.output_config = { format: { type: 'json_schema', schema } };
      const res = await client.messages.create(req);
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const toolCalls = res.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
      return {
        text,
        toolCalls,
        usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
        stopReason: res.stop_reason,
      };
    },
  };
}
