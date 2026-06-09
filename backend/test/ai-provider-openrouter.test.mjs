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
    const p = createOpenRouterProvider({ model: 'anthropic/claude-sonnet-4-6', apiKey: 'test-key' });
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
    const p = createOpenRouterProvider({ model: 'm', apiKey: 'test-key' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_pl', description: 'd', inputSchema: { type: 'object' } }] });
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'get_pl', input: { period: 'month' } }]);
    expect(createMock.mock.calls[0][0].tools[0]).toEqual({ type: 'function', function: { name: 'get_pl', description: 'd', parameters: { type: 'object' } } });
  });

  it('maps schema to response_format json_schema', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '{}', tool_calls: [] }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const p = createOpenRouterProvider({ model: 'm', apiKey: 'test-key' });
    await p.chat({ messages: [{ role: 'user', content: 'q' }], schema: { type: 'object' } });
    expect(createMock.mock.calls[0][0].response_format).toEqual({ type: 'json_schema', json_schema: { name: 'structured_output', strict: true, schema: { type: 'object' } } });
  });
});

describe('openrouter adapter block-array content', () => {
  it('maps tool_use assistant turn and tool_result user turn correctly', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: null, tool_calls: [] }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const p = createOpenRouterProvider({ model: 'm', apiKey: 'test-key' });
    await p.chat({
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_metrics', input: { period: '2026-05' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', name: 'get_metrics', content: '{"x":1}' }] },
      ],
    });
    const sent = createMock.mock.calls[0][0].messages;
    const assistantMsg = sent.find((m) => m.role === 'assistant' && m.tool_calls);
    expect(assistantMsg.tool_calls[0]).toEqual({ id: 't1', type: 'function', function: { name: 'get_metrics', arguments: '{"period":"2026-05"}' } });
    expect(assistantMsg.content).toBeNull();
    const toolMsg = sent.find((m) => m.role === 'tool');
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 't1', content: '{"x":1}' });
  });
});
