// backend/test/practice-cost-model-service.test.mjs
import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/practice-cost-model.repository.js', () => ({
  practiceCostModelRepository: {
    asOf: vi.fn(async () => [
      { practice_id: 'P1', effective_from: '2026-01-01', fixed_cost_pence_month: 3100000,
        breakeven_low_pence: 8100000, breakeven_high_pence: 8600000,
        working_days_per_month: 20, revenue_target_pence_month: 40000000 },
    ]),
    upsert: vi.fn(async (orgId, practiceId, effectiveFrom, fields) => ({
      practice_id: practiceId, effective_from: effectiveFrom, working_days_per_month: 20, ...fields,
    })),
  },
}));
vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    activePractices: vi.fn(async () => [
      { id: 'P1', name: 'Ashford' },
      { id: 'P9', name: 'Warwick Lodge' },
    ]),
  },
}));

let practiceCostModelService, practiceCostModelRepository;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ practiceCostModelService } = await import('../src/services/practice-cost-model.service.js'));
  ({ practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js'));
});

describe('practiceCostModelService.list', () => {
  it('returns a row for every active practice, nulls where no model is set', async () => {
    const out = await practiceCostModelService.list('ORG1', { asOf: '2026-07-17' });
    expect(out.rows).toHaveLength(2);

    const ashford = out.rows.find((r) => r.practiceId === 'P1');
    expect(ashford.fixedCostPenceMonth).toBe(3100000);
    expect(ashford.workingDaysPerMonth).toBe(20);

    // Warwick Lodge has no model — nulls, NOT zeros. A zero would render as a
    // real £0 fixed cost and drag §6's group row down with a fiction.
    const warwick = out.rows.find((r) => r.practiceId === 'P9');
    expect(warwick.name).toBe('Warwick Lodge');
    expect(warwick.fixedCostPenceMonth).toBeNull();
    expect(warwick.effectiveFrom).toBeNull();
    // working days still defaults, since it has a NOT NULL DEFAULT 20
    expect(warwick.workingDaysPerMonth).toBe(20);
  });

  it('defaults asOf to today when not given', async () => {
    await practiceCostModelService.list('ORG1', {});
    const asOf = practiceCostModelRepository.asOf.mock.calls[0][1];
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('practiceCostModelService.save', () => {
  it('writes at effective_from = today so history is preserved', async () => {
    await practiceCostModelService.save('ORG1', 'P1', { fixedCostPenceMonth: 3300000 });
    const [orgId, practiceId, effectiveFrom] = practiceCostModelRepository.upsert.mock.calls[0];
    expect(orgId).toBe('ORG1');
    expect(practiceId).toBe('P1');
    expect(effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // CRITICAL 1 regression guard. The bug: save() upserted at
  // effective_from=today with ONLY the supplied fields. If today had no row
  // yet, that upsert was an INSERT, so every unsupplied column took its
  // column default (NULL) — a daily-target-only edit wiped the fixed cost /
  // breakeven figures set on an earlier day, and vice versa. The fix reads
  // today's model first and merges the supplied fields OVER it, so an INSERT
  // carries the existing values forward instead of defaulting them to null.
  // These tests assert the ACTUAL VALUES handed to upsert — not just which
  // keys are present — because the original version of this test asserted
  // only shape and passed while the bug shipped.
  it('a partial edit merges over today\'s existing model — it must not null the rest', async () => {
    // Fixture existing model for P1 (from the asOf mock above): fixed
    // £31,000/mo, breakeven £81,000-86,000, 20 working days, target £400,000/mo.
    await practiceCostModelService.save('ORG1', 'P1', { revenueTargetPenceMonth: 50000000 });
    const fields = practiceCostModelRepository.upsert.mock.calls[0][3];
    expect(fields).toEqual({
      fixed_cost_pence_month: 3100000,
      breakeven_low_pence: 8100000,
      breakeven_high_pence: 8600000,
      working_days_per_month: 20,
      revenue_target_pence_month: 50000000,
    });
  });

  it('the mirror case: setting the cost model on a new day must preserve an existing target', async () => {
    // CostModelForm omits revenueTargetPenceMonth entirely — it must survive.
    await practiceCostModelService.save('ORG1', 'P1', {
      fixedCostPenceMonth: 3300000,
      breakevenLowPence: 8200000,
      breakevenHighPence: 8700000,
      workingDaysPerMonth: 22,
    });
    const fields = practiceCostModelRepository.upsert.mock.calls[0][3];
    expect(fields).toEqual({
      fixed_cost_pence_month: 3300000,
      breakeven_low_pence: 8200000,
      breakeven_high_pence: 8700000,
      working_days_per_month: 22,
      revenue_target_pence_month: 40000000, // carried forward, untouched
    });
  });

  it('a practice with no model yet at all still writes only the supplied fields', async () => {
    practiceCostModelRepository.asOf.mockImplementationOnce(async () => []); // no row for P1 today
    await practiceCostModelService.save('ORG1', 'P1', { revenueTargetPenceMonth: 12000000 });
    const fields = practiceCostModelRepository.upsert.mock.calls[0][3];
    expect(fields).toEqual({ revenue_target_pence_month: 12000000 });
  });

  it('rejects a practice outside the org', async () => {
    await expect(practiceCostModelService.save('ORG1', 'NOT-MINE', { fixedCostPenceMonth: 1 }))
      .rejects.toThrow(/practice not found/i);
  });

  it('throws a 404 AppError (not a plain 500-worthy Error) for a practice outside the org', async () => {
    const { AppError } = await import('../src/middleware/errors.js');
    await expect(practiceCostModelService.save('ORG1', 'NOT-MINE', { fixedCostPenceMonth: 1 }))
      .rejects.toBeInstanceOf(AppError);
    try {
      await practiceCostModelService.save('ORG1', 'NOT-MINE', { fixedCostPenceMonth: 1 });
    } catch (err) {
      expect(err.statusCode).toBe(404);
    }
  });
});
