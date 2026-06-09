// backend/test/ai-provider-anthropic.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { this.messages = { create: createMock }; } },
}));

const { createAnthropicProvider } = await import('../src/lib/ai/providers/anthropic.js');

beforeEach(() => createMock.mockReset());

describe('anthropic adapter', () => {
  it('normalises text + usage', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 3 },
      stop_reason: 'end_turn',
    });
    const p = createAnthropicProvider({ model: 'claude-sonnet-4-6' });
    const r = await p.chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('hello');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
    expect(r.stopReason).toBe('end_turn');
    expect(createMock.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('normalises tool_use blocks into toolCalls', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'get_pl', input: { period: 'month' } }],
      usage: { input_tokens: 5, output_tokens: 2 },
      stop_reason: 'tool_use',
    });
    const p = createAnthropicProvider({ model: 'm' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_pl', description: 'd', inputSchema: { type: 'object' } }] });
    expect(r.toolCalls).toEqual([{ id: 'tu_1', name: 'get_pl', input: { period: 'month' } }]);
    expect(createMock.mock.calls[0][0].tools[0]).toEqual({ name: 'get_pl', description: 'd', input_schema: { type: 'object' } });
  });

  it('maps schema to output_config.format', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' });
    const p = createAnthropicProvider({ model: 'm' });
    await p.chat({ messages: [{ role: 'user', content: 'q' }], schema: { type: 'object' } });
    expect(createMock.mock.calls[0][0].output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
  });
});
