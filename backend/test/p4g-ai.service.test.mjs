// backend/test/p4g-ai.service.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/lib/gemini.js', () => ({
  askPlan4GrowthAI: vi.fn(async () => ({ reply: 'ok', usage: { inputTokens: 10, outputTokens: 5 } })),
}));

const { p4gAiService } = await import('../src/services/p4g-ai.service.js');

const ORG = 'org-chat';
beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('p4gAiService.chat', () => {
  it('records usage after a successful chat', async () => {
    let inserted = null;
    supaRec.resultProvider = (q) => {
      if (q.table === 'ai_config') return { data: null, error: null };
      if (q.table === 'ai_usage' && q.op === 'select') return { data: [], error: null };
      if (q.table === 'ai_usage' && q.op === 'insert') { inserted = q.insertVals; return { data: [], error: null }; }
      return { data: [], error: null };
    };
    const r = await p4gAiService.chat(ORG, { message: 'how am I doing?', history: [] });
    expect(r.reply).toBe('ok');
    expect(inserted?.organisation_id).toBe(ORG);
  });

  it('blocks when budget exceeded', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'ai_config') return { data: { monthly_token_budget: 1 }, error: null };
      if (q.table === 'ai_usage') return { data: [{ input_tokens: 5, output_tokens: 5 }], error: null };
      return { data: [], error: null };
    };
    await expect(p4gAiService.chat(ORG, { message: 'x', history: [] })).rejects.toMatchObject({ statusCode: 429 });
  });
});
