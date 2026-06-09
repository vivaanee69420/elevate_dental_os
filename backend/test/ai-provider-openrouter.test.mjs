// backend/test/ai-provider-openrouter.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class { constructor() { this.chat = { completions: { create: createMock } }; } },
}));

const { createOpenRouterProvider } = await import('../src/lib/ai/providers/openrouter.js');

beforeEach(() => createMock.mockReset());

describe('openrouter adapter', () => {
  it('puts system first and normalises text + usage', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'hi back', tool_calls: [] }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 4 },
    });
    const p = createOpenRouterProvider({ model: 'anthropic/claude-sonnet-4-6' });
    const r = await p.chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('hi back');
    expect(r.usage).toEqual({ inputTokens: 8, outputTokens: 4 });
    const sent = createMock.mock.calls[0][0];
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('parses tool_calls JSON arguments into input objects', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'get_pl', arguments: '{"period":"month"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
    const p = createOpenRouterProvider({ model: 'm' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_pl', description: 'd', inputSchema: { type: 'object' } }] });
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'get_pl', input: { period: 'month' } }]);
    expect(createMock.mock.calls[0][0].tools[0]).toEqual({ type: 'function', function: { name: 'get_pl', description: 'd', parameters: { type: 'object' } } });
  });

  it('maps schema to response_format json_schema', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '{}', tool_calls: [] }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const p = createOpenRouterProvider({ model: 'm' });
    await p.chat({ messages: [{ role: 'user', content: 'q' }], schema: { type: 'object' } });
    expect(createMock.mock.calls[0][0].response_format).toEqual({ type: 'json_schema', json_schema: { name: 'structured_output', strict: true, schema: { type: 'object' } } });
  });
});
