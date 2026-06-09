// backend/src/lib/ai/providers/anthropic.js
// ============================================================================
// Anthropic adapter — implements the provider contract over @anthropic-ai/sdk.
// ============================================================================
import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicProvider({ model, apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const client = new Anthropic({ apiKey });
  return {
    name: 'anthropic',
    model,
    async chat({ system, messages, tools, maxTokens = 1024, schema } = {}) {
      const req = { model, max_tokens: maxTokens, messages };
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
