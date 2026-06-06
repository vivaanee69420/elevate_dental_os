// ============================================================================
// Treatment Economics Workbench formula — computeServiceEconomics. Integer
// pence; Full Arch golden values hand-computed from DEFAULT_SERVICE_MODELS.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computeServiceEconomics, DEFAULT_SERVICE_MODELS } from '../src/lib/formulas.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const { treatmentModelSchema } = await import('../src/models/analytics.model.js');

describe('computeServiceEconomics — Full Arch default (hand-verified golden)', () => {
  const r = computeServiceEconomics(DEFAULT_SERVICE_MODELS.fullarch);

  it('component + lab margins', () => {
    expect(r.compRetailPence).toBe(258_000);
    expect(r.compCostPence).toBe(148_000);
    expect(r.compProfitPence).toBe(110_000);
    expect(r.labProfitPence).toBe(105_000); // 350,000 * 30%
    expect(r.directTreatmentCostPence).toBe(498_000); // compCost + labBill
  });

  it('gross, clinician, practice + group profit', () => {
    expect(r.grossBeforeDentistPence).toBe(482_100); // 1,000,000 - 19,900 - 498,000
    expect(r.dentistGrossPence).toBe(192_840);       // 40%
    expect(r.marketingPence).toBe(100_000);          // 10% of fee
    expect(r.practiceProfitPence).toBe(129_260);     // 482100 - 192840 - 100000 - 0 - 60000
    expect(r.groupProfitPence).toBe(364_160);        // + compProfit + labProfit + cbct
    expect(r.marginPct).toBe(36.4);
  });

  it('CAC, max-ad, monthly + annual, principal uplift', () => {
    expect(r.cacPence).toBe(100_000);                // case unit -> marketing * 1
    expect(r.maxAdAt20Pence).toBe(264_160);          // group + marketing - 20% of fee
    expect(r.monthlyCases).toBe(2);
    expect(r.monthlyProfitPence).toBe(728_320);      // 2 * group
    expect(r.annualProfitPence).toBe(8_739_840);     // * 12
    expect(r.principalProfitPence).toBe(557_000);    // group + dentistGross
    expect(r.principalUpliftPence).toBe(192_840);    // dentistGross
  });

  it('target-price solver returns 0 when contribution slope < target margin', () => {
    // Practice contribution slope = (482100-192840)/1,000,000 = 28.9%, below the
    // 35% target -> a 35% margin is unreachable by price alone (add-backs are
    // what lift the GROUP margin to 36.4%). Prototype behaviour: targetPrice = 0.
    expect(r.targetPricePence).toBe(0);
  });

  it('target-price solver returns a positive price when slope > target margin', () => {
    // Same model, 20% target (< 28.9% slope) -> solvable.
    const solvable = computeServiceEconomics({ ...DEFAULT_SERVICE_MODELS.fullarch, targetMarginPct: 20 });
    expect(solvable.targetPricePence).toBeGreaterThan(0);
  });

  it('per-component profit breakdown', () => {
    const implant = r.components.find((c) => c.name === 'Implant');
    expect(implant.profitPence).toBe(42_000); // (21000-10500)*4
  });
});

describe('computeServiceEconomics — implant unit (patients vs cases)', () => {
  const r = computeServiceEconomics(DEFAULT_SERVICE_MODELS.implant);
  it('implant patients = cases / implants-per-patient; CAC scales by ipp', () => {
    expect(r.monthlyCases).toBe(20);
    expect(r.patients).toBe(10);          // 20 / 2
    expect(r.cacPence).toBe(r.marketingPence * 2); // implant unit -> marketing * ipp
  });
});

describe('computeServiceEconomics — guards', () => {
  it('zero/empty model -> no NaN', () => {
    const r = computeServiceEconomics({ unit: 'case', components: [] });
    expect(r.groupProfitPence).toBe(0);
    expect(r.marginPct).toBe(0);
    expect(r.targetPricePence).toBe(0);
    expect(r.monthlyCases).toBe(0);
  });
});

describe('endpoint wiring (schema + service)', () => {
  it('treatmentModelSchema coerces strings + applies defaults', () => {
    const m = treatmentModelSchema.parse({ pricePence: '205000', unit: 'implant' });
    expect(m.pricePence).toBe(205000);
    expect(m.dentistPct).toBe(0); // default
    expect(m.components).toEqual([]);
    expect(m.implantsPerPatient).toBe(1);
  });
  it('rejects a negative price', () => {
    expect(() => treatmentModelSchema.parse({ pricePence: -5 })).toThrow();
  });
  it('service.treatmentEconomics returns computed group profit; treatmentModels returns defaults', () => {
    const out = svc.treatmentEconomics(DEFAULT_SERVICE_MODELS.fullarch);
    expect(out.groupProfitPence).toBe(364_160);
    expect(svc.treatmentModels().implant.unit).toBe('implant');
  });
});

// ----------------------------------------------------------------------------
// classifyCaseFees — real case-fee seeding from Dentally invoice rollups.
// Names below are REAL Dentally catalog labels probed from the live API.
// ----------------------------------------------------------------------------
import { classifyCaseFees } from '../src/lib/formulas.js';

describe('classifyCaseFees', () => {
    it('attributes whole-invoice totals by procedure keyword (real catalog names)', () => {
        const invoices = [
            // Full implant case across components on one invoice: 1177+806+898 = 2881.
            { names: ['Placement Of Implant', 'Implant Abutment', 'Implant Crown'], total_pence: 288100 },
            // Another implant invoice (placement only).
            { names: ['Placement Of Implant'], total_pence: 117700 },
            // Full arch.
            { names: ['All-on-4 Surgery Single Arch'], total_pence: 614000 },
            // Invisalign package.
            { names: ['Invisalign Comprehensive', 'Essix Retainer Upper'], total_pence: 292300 },
            { names: ['Invisalign'], total_pence: 146000 },
            // Noise that must NOT count toward implant (consult/x-ray only).
            { names: ['Implant Consultation'], total_pence: 3100 },
            { names: ['OPG Panoramic X-ray'], total_pence: 6100 },
            // Invisalign Review (£0 and excluded by /review/) — ignored.
            { names: ['Invisalign Review'], total_pence: 0 },
        ];
        const out = classifyCaseFees(invoices);
        // implant: invoices [2881, 1177] -> mean 2029 (consult-only invoice excluded).
        expect(out.implant).toEqual({ feePence: 202900, sampleSize: 2 });
        // fullarch: one invoice 6140.
        expect(out.fullarch).toEqual({ feePence: 614000, sampleSize: 1 });
        // invisalign: [2923, 1460] -> mean 2191.5 -> 219150. Review excluded.
        expect(out.invisalign).toEqual({ feePence: 219150, sampleSize: 2 });
    });

    it('null per category when no matching invoices', () => {
        const out = classifyCaseFees([{ names: ['Exam', 'Scale & Polish'], total_pence: 9000 }]);
        expect(out.fullarch).toBeNull();
        expect(out.implant).toBeNull();
        expect(out.invisalign).toBeNull();
    });

    it('skips zero/negative-total and empty-name invoices', () => {
        const out = classifyCaseFees([
            { names: ['Placement Of Implant'], total_pence: 0 },
            { names: [], total_pence: 50000 },
            { names: ['Balance imported from previous system'], total_pence: -4600 },
        ]);
        expect(out.implant).toBeNull();
    });
});
