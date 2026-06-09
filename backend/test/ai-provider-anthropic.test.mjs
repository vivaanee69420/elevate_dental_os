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
    const p = createAnthropicProvider({ model: 'claude-sonnet-4-6', apiKey: 'test-key' });
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
    const p = createAnthropicProvider({ model: 'm', apiKey: 'test-key' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_pl', description: 'd', inputSchema: { type: 'object' } }] });
    expect(r.toolCalls).toEqual([{ id: 'tu_1', name: 'get_pl', input: { period: 'month' } }]);
    expect(createMock.mock.calls[0][0].tools[0]).toEqual({ name: 'get_pl', description: 'd', input_schema: { type: 'object' } });
  });

  it('maps schema to output_config.format', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' });
    const p = createAnthropicProvider({ model: 'm', apiKey: 'test-key' });
    await p.chat({ messages: [{ role: 'user', content: 'q' }], schema: { type: 'object' } });
    expect(createMock.mock.calls[0][0].output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
  });
});

describe('anthropic adapter block-array content', () => {
  it('translates tool_use / tool_result blocks to SDK shape', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' });
    const p = createAnthropicProvider({ model: 'm', apiKey: 'k' });
    await p.chat({ messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_metrics', input: { period: '2026-05' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', name: 'get_metrics', content: '{"x":1}' }] },
    ] });
    const sent = createMock.mock.calls[0][0].messages;
    expect(sent[1].content[0]).toEqual({ type: 'tool_use', id: 't1', name: 'get_metrics', input: { period: '2026-05' } });
    expect(sent[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: '{"x":1}' });
  });
});
