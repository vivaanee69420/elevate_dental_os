// backend/test/ai-guardrails-budget.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { checkBudget, recordUsage, DEFAULT_MONTHLY_TOKEN_BUDGET } = await import('../src/lib/ai/guardrails.js');

const ORG = 'org-budget';
beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('checkBudget', () => {
  it('passes when under budget', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'ai_config') return { data: null, error: null };
      if (q.table === 'ai_usage') return { data: [{ input_tokens: 100, output_tokens: 50 }], error: null };
      return { data: [], error: null };
    };
    await expect(checkBudget(ORG)).resolves.toBeUndefined();
  });
  it('throws AppError 429 when over budget', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'ai_config') return { data: { monthly_token_budget: 100 }, error: null };
      if (q.table === 'ai_usage') return { data: [{ input_tokens: 90, output_tokens: 20 }], error: null };
      return { data: [], error: null };
    };
    await expect(checkBudget(ORG)).rejects.toMatchObject({ statusCode: 429 });
  });
});

describe('recordUsage', () => {
  it('inserts an ai_usage row scoped to the org', async () => {
    let inserted = null;
    supaRec.resultProvider = (q) => { if (q.op === 'insert' && q.table === 'ai_usage') inserted = q.insertVals; return { data: [], error: null }; };
    await recordUsage(ORG, { feature: 'chat', model: 'm', usage: { inputTokens: 10, outputTokens: 5 } });
    expect(inserted.organisation_id).toBe(ORG);
    expect(inserted.feature).toBe('chat');
    expect(inserted.cost_pence).toBeGreaterThanOrEqual(0);
  });
});
