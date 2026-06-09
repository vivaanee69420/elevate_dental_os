import { describe, it, expect, vi, beforeEach } from 'vitest';

const EMPTY = { meta: { data_coverage: { financials: false, baseline: false, appointments: false } } };

describe('p4gAiService.chat empty-data guard', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('short-circuits without calling the model when context is empty', async () => {
    vi.doMock('../src/lib/ai/guardrails.js', () => ({
      checkBudget: vi.fn().mockResolvedValue(), recordUsage: vi.fn(), delimit: (t, c) => c,
    }));
    const askSpy = vi.fn();
    vi.doMock('../src/lib/gemini.js', () => ({ askPlan4GrowthAI: askSpy }));
    vi.doMock('../src/repositories/p4g-ai.repository.js', () => ({
      p4gAiRepository: { health: vi.fn().mockResolvedValue({}), latestSnapshot: vi.fn().mockResolvedValue([]) },
    }));
    vi.doMock('../src/services/analytics.service.js', () => ({
      analyticsService: { getLiveContextData: vi.fn().mockResolvedValue(EMPTY) },
    }));

    const { p4gAiService } = await import('../src/services/p4g-ai.service.js');
    const out = await p4gAiService.chat('org-1', { message: 'how is my margin?' }, 'user-1');

    expect(askSpy).not.toHaveBeenCalled();
    expect(out.reply).toMatch(/connect/i);
    expect(out.missing).toEqual(expect.arrayContaining(['financials', 'baseline']));
  });

  it('calls the model normally when context has data', async () => {
    vi.doMock('../src/lib/ai/guardrails.js', () => ({
      checkBudget: vi.fn().mockResolvedValue(), recordUsage: vi.fn().mockResolvedValue(), delimit: (t, c) => c,
    }));
    const askSpy = vi.fn().mockResolvedValue({ reply: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });
    vi.doMock('../src/lib/gemini.js', () => ({ askPlan4GrowthAI: askSpy }));
    vi.doMock('../src/repositories/p4g-ai.repository.js', () => ({
      p4gAiRepository: { health: vi.fn().mockResolvedValue({}), latestSnapshot: vi.fn().mockResolvedValue([]) },
    }));
    vi.doMock('../src/services/analytics.service.js', () => ({
      analyticsService: { getLiveContextData: vi.fn().mockResolvedValue({ meta: { data_coverage: { financials: true, baseline: false, appointments: false } } }) },
    }));

    const { p4gAiService } = await import('../src/services/p4g-ai.service.js');
    const out = await p4gAiService.chat('org-1', { message: 'hi' }, 'user-1');
    expect(askSpy).toHaveBeenCalled();
    expect(out.reply).toBe('ok');
  });
});

describe('p4gAiService.chat tool loop', () => {
  beforeEach(() => vi.resetModules());
  it('runs get_metrics when the model requests it, then returns the reply', async () => {
    const NONEMPTY = { meta: { data_coverage: { financials: true, baseline: true, appointments: true } }, pl: { revenuePence: 100000 } };
    vi.doMock('../src/lib/ai/guardrails.js', () => ({ checkBudget: vi.fn().mockResolvedValue(), recordUsage: vi.fn(), delimit: (t, c) => c }));
    vi.doMock('../src/repositories/p4g-ai.repository.js', () => ({ p4gAiRepository: { health: vi.fn().mockResolvedValue({}), latestSnapshot: vi.fn().mockResolvedValue([]) } }));
    vi.doMock('../src/services/analytics.service.js', () => ({ analyticsService: { getLiveContextData: vi.fn().mockResolvedValue(NONEMPTY) } }));
    vi.doMock('../src/lib/gemini.js', async () => await vi.importActual('../src/lib/gemini.js'));
    // provider scripts a tool call then a text answer
    let i = 0;
    const scripts = [
      { text: '', toolCalls: [{ id: 'c1', name: 'get_metrics', input: { period: '2026-04' } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_use' },
      { text: 'Your April margin was 18%.', toolCalls: [], usage: { inputTokens: 2, outputTokens: 2 }, stopReason: 'end_turn' },
    ];
    vi.doMock('../src/lib/ai/index.js', () => ({ getProvider: () => ({ name: 'fake', model: 'm', chat: vi.fn(async () => scripts[Math.min(i++, scripts.length - 1)]) }) }));
    vi.doMock('../src/lib/ai/tools/get-metrics.js', () => ({ getMetricsTool: { name: 'get_metrics', inputSchema: { type: 'object' } }, makeGetMetricsExecutor: () => vi.fn().mockResolvedValue({ pl: { marginPct: 18 } }) }));

    const { p4gAiService } = await import('../src/services/p4g-ai.service.js');
    const out = await p4gAiService.chat('org-1', { message: 'how was April?' }, 'user-1');
    expect(out.reply).toMatch(/April margin/);
  });
});

describe('taskService.generateAiTasks empty-data guard', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('returns [] and does not call the generator when context is empty', async () => {
    vi.doMock('../src/lib/ai/guardrails.js', () => ({
      checkBudget: vi.fn().mockResolvedValue(), recordUsage: vi.fn(), delimit: (t, c) => c,
    }));
    const genSpy = vi.fn();
    vi.doMock('../src/lib/gemini.js', () => ({ generateTasksFromData: genSpy }));
    vi.doMock('../src/repositories/auth.repository.js', () => ({
      authRepository: { listOrgMembers: vi.fn().mockResolvedValue({ data: [], error: null }) },
    }));
    vi.doMock('../src/services/analytics.service.js', () => ({
      analyticsService: { getLiveContextData: vi.fn().mockResolvedValue(EMPTY) },
    }));

    const { taskService } = await import('../src/services/task.service.js');
    const out = await taskService.generateAiTasks('org-1', 'user-1');
    expect(genSpy).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });
});
