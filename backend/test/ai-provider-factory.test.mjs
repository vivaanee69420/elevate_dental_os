// backend/test/ai-provider-factory.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { this.messages = { create: vi.fn() }; } } }));
vi.mock('openai', () => ({ default: class { constructor() { this.chat = { completions: { create: vi.fn() } }; } } }));

const { getProvider } = await import('../src/lib/ai/index.js');

const ENV = { ...process.env };
beforeEach(() => { process.env = { ...ENV }; });
afterEach(() => { process.env = ENV; });

describe('getProvider', () => {
  it('defaults to anthropic + claude-sonnet-4-6', () => {
    delete process.env.AI_PROVIDER; delete process.env.AI_MODEL;
    const p = getProvider();
    expect(p.name).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-4-6');
  });
  it('selects openrouter via AI_PROVIDER', () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.AI_MODEL = 'anthropic/claude-sonnet-4-6';
    expect(getProvider().name).toBe('openrouter');
  });
  it('throws on unknown provider', () => {
    process.env.AI_PROVIDER = 'bogus';
    expect(() => getProvider()).toThrow(/unknown AI_PROVIDER/i);
  });
});
