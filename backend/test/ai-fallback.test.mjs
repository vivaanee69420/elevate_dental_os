// ============================================================================
// AI fallback and Gemini provider tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProvider } from '../src/lib/ai/index.js';

describe('Gemini and Fallback Provider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('direct gemini provider formats contents and calls fetch correctly', async () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Gemini reply' }],
            role: 'model'
          },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5
      }
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });
    global.fetch = fetchSpy;

    const provider = getProvider();
    expect(provider.name).toBe('gemini');

    const result = await provider.chat({
      system: 'You are a dentist',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'help' }
      ],
      schema: { type: 'object', additionalProperties: false }
    });

    expect(result.text).toBe('Gemini reply');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain('gemini-2.5-flash');
    expect(calledUrl).toContain('key=test-gemini-key');

    const payload = JSON.parse(calledOptions.body);
    expect(payload.systemInstruction.parts[0].text).toBe('You are a dentist');
    expect(payload.contents[0].role).toBe('user');
    expect(payload.contents[1].role).toBe('model'); // mapped from assistant
    expect(payload.contents[2].role).toBe('user');
    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseSchema.additionalProperties).toBeUndefined();
  });

  it('falls back to gemini when primary key is missing', async () => {
    process.env.AI_PROVIDER = 'anthropic';
    process.env.AI_MODEL = 'claude-sonnet-4-6';
    delete process.env.ANTHROPIC_API_KEY; // missing primary key
    process.env.GEMINI_API_KEY = 'fallback-key';

    const mockResponse = {
      candidates: [
        {
          content: { parts: [{ text: 'Gemini fallback reply' }] },
          finishReason: 'STOP'
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const provider = getProvider();
    expect(provider.name).toBe('anthropic-with-fallback');

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(result.text).toBe('Gemini fallback reply');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to gemini when primary chat throws an error', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.AI_MODEL = 'claude-sonnet-4-6';
    process.env.OPENROUTER_API_KEY = 'primary-key';
    process.env.GEMINI_API_KEY = 'fallback-key';

    // Mock openrouter adapter method
    const provider = getProvider();
    expect(provider.name).toBe('openrouter-with-fallback');

    // Spy/Mock global fetch for Gemini call
    const mockResponse = {
      candidates: [
        {
          content: { parts: [{ text: 'Gemini fallback after error' }] },
          finishReason: 'STOP'
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    // We override primary chat to throw
    provider.chat = provider.chat.bind(provider);
    const originalChat = provider.chat;

    // Simulate primary failure by mocking fetch to fail for OpenAI but return mockResponse for Gemini
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('openrouter.ai')) {
        return Promise.reject(new Error('Rate limit or connection issue'));
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockResponse
      });
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(result.text).toBe('Gemini fallback after error');
  });
});
