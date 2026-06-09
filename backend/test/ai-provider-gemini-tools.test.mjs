// backend/test/ai-provider-gemini-tools.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { createGeminiProvider } = await import('../src/lib/ai/providers/gemini.js');

const okBody = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

beforeEach(() => { vi.restoreAllMocks(); });

describe('gemini adapter function-calling', () => {
  it('maps tools to functionDeclarations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    }));
    const p = createGeminiProvider({ model: 'gemini-x', apiKey: 'k' });
    await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics', description: 'd', inputSchema: { type: 'object', properties: {} } }] });
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(payload.tools[0].functionDeclarations[0]).toMatchObject({ name: 'get_metrics', description: 'd' });
  });

  it('parses functionCall parts into toolCalls + tool-use stopReason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody({
      candidates: [{ content: { parts: [{ functionCall: { name: 'get_metrics', args: { period: '2026-05' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
    }));
    const p = createGeminiProvider({ model: 'm', apiKey: 'k' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics', description: 'd', inputSchema: { type: 'object' } }] });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: 'get_metrics', input: { period: '2026-05' } });
    expect(r.toolCalls[0].id).toBeTruthy();
    expect(r.stopReason).toBe('tool_use');
  });

  it('round-trips a tool_result block into a functionResponse part', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody({
      candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2 },
    }));
    const p = createGeminiProvider({ model: 'm', apiKey: 'k' });
    await p.chat({ messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'gem_0', name: 'get_metrics', input: { period: '2026-05' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'gem_0', name: 'get_metrics', content: '{"pl":{"revenuePence":100}}' }] },
    ] });
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const modelTurn = payload.contents.find((c) => c.role === 'model');
    const respTurn = payload.contents.find((c) => c.parts.some((p) => p.functionResponse));
    expect(modelTurn.parts[0].functionCall).toMatchObject({ name: 'get_metrics', args: { period: '2026-05' } });
    expect(respTurn.parts[0].functionResponse).toMatchObject({ name: 'get_metrics', response: { pl: { revenuePence: 100 } } });
  });

  it('still handles plain string content (Phase 1 path)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody({
      candidates: [{ content: { parts: [{ text: 'plain' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }));
    const p = createGeminiProvider({ model: 'm', apiKey: 'k' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }] });
    expect(r.text).toBe('plain');
    expect(r.toolCalls).toEqual([]);
  });

  it('parses a functionCall with no args', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody({
      candidates: [{ content: { parts: [{ functionCall: { name: 'get_metrics' } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
    }));
    const p = createGeminiProvider({ model: 'm', apiKey: 'k' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics', description: 'd', inputSchema: { type: 'object' } }] });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].input).toEqual({});
  });

  it('accumulates text emitted before a functionCall', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody({
      candidates: [{ content: { parts: [{ text: 'thinking ' }, { functionCall: { name: 'get_metrics', args: { period: '2026-05' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    }));
    const p = createGeminiProvider({ model: 'm', apiKey: 'k' });
    const r = await p.chat({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'get_metrics', description: 'd', inputSchema: { type: 'object' } }] });
    expect(r.text).toBe('thinking ');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].input).toEqual({ period: '2026-05' });
  });
});
