// backend/test/ai-tool-loop.test.mjs
import { describe, it, expect, vi } from 'vitest';
const { runToolLoop } = await import('../src/lib/ai/tool-loop.js');

// A fake provider whose chat() returns scripted replies in order.
function fakeProvider(scripts) {
  let i = 0;
  return { name: 'fake', model: 'm', chat: vi.fn(async () => scripts[Math.min(i++, scripts.length - 1)]) };
}

describe('runToolLoop', () => {
  it('executes a tool call then returns the follow-up text', async () => {
    const provider = fakeProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'get_metrics', input: { period: '2026-05' } }], usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'tool_use' },
      { text: 'Revenue was £1,000.', toolCalls: [], usage: { inputTokens: 6, outputTokens: 4 }, stopReason: 'end_turn' },
    ]);
    const exec = vi.fn(async () => ({ pl: { revenuePence: 100000 } }));
    let usage;
    const out = await runToolLoop({ provider, system: 's', messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics' }], executors: { get_metrics: exec }, onUsage: (u) => { usage = u; } });
    expect(exec).toHaveBeenCalledWith({ period: '2026-05' });
    expect(out.text).toBe('Revenue was £1,000.');
    expect(usage).toEqual({ inputTokens: 11, outputTokens: 5 }); // summed across both turns
    // second provider call carried the tool_result turn
    const secondMsgs = provider.chat.mock.calls[1][0].messages;
    expect(secondMsgs.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', name: 'get_metrics' }] });
  });

  it('turns a throwing executor into a tool_error result, not a throw', async () => {
    const provider = fakeProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'get_metrics', input: {} }], usage: {}, stopReason: 'tool_use' },
      { text: 'sorry', toolCalls: [], usage: {}, stopReason: 'end_turn' },
    ]);
    const exec = vi.fn(async () => { throw new Error('boom'); });
    await runToolLoop({ provider, messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics' }], executors: { get_metrics: exec } });
    const resultTurn = provider.chat.mock.calls[1][0].messages.at(-1);
    expect(JSON.parse(resultTurn.content[0].content)).toEqual({ tool_error: 'boom' });
    expect(resultTurn.content[0]).toMatchObject({ type: 'tool_result', toolUseId: 'c1', name: 'get_metrics' });
  });

  it('respects maxRounds: stops sending tools and forces a final answer', async () => {
    const toolReply = { text: '', toolCalls: [{ id: 'c', name: 'get_metrics', input: {} }], usage: {}, stopReason: 'tool_use' };
    const provider = fakeProvider([toolReply, toolReply, { text: 'final', toolCalls: [], usage: {}, stopReason: 'end_turn' }]);
    const out = await runToolLoop({ provider, messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics' }], executors: { get_metrics: async () => ({}) }, maxRounds: 2 });
    // last call must omit tools (forces the model to answer)
    expect(provider.chat.mock.calls.at(-1)[0].tools).toBeUndefined();
    expect(out.text).toBe('final');
  });

  it('forwards maxTokens to provider.chat on every call', async () => {
    const provider = fakeProvider([
      { text: 'answer', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end_turn' },
    ]);
    await runToolLoop({ provider, system: 's', messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics' }], executors: {}, maxTokens: 999 });
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(provider.chat.mock.calls[0][0].maxTokens).toBe(999);
  });

  it('does a final schema-formatting turn when a schema is passed', async () => {
    const provider = fakeProvider([
      { text: 'thinking', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end_turn' },
      { text: '{"answer":"ok"}', toolCalls: [], usage: { inputTokens: 2, outputTokens: 2 }, stopReason: 'end_turn' },
    ]);
    const out = await runToolLoop({ provider, messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics' }], executors: {}, schema: { type: 'object' } });
    // final call carried the schema and no tools
    const finalCall = provider.chat.mock.calls.at(-1)[0];
    expect(finalCall.schema).toEqual({ type: 'object' });
    expect(finalCall.tools).toBeUndefined();
    expect(out.text).toBe('{"answer":"ok"}');
  });
});
