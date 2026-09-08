// ============================================================================
// Saved treatment models — the workbench finally remembers.
//
// It has been a calculator with no memory since it shipped: the model lived in
// React, was POSTed to a pure compute endpoint, and was gone on refresh. The
// costs it holds — lab bill, component prices, surgery run cost, utilities —
// are in NO feed. Dentally sends what the patient paid and never what the work
// cost; QuickBooks has costs only at company level. So those figures were the
// only copy in the system, and a page refresh destroyed them.
//
// The three built-ins stay in formulas.js. A saved row keyed to one of them is
// an OVERRIDE, and deleting it restores the default — that is the entire reset
// mechanism, with no flag and no second code path.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const { DEFAULT_SERVICE_MODELS } = await import('../src/lib/formulas.js');

const ORG = 'org-treatments';
const OTHER_ORG = 'org-someone-else';

/** A stored row as the repository returns it (snake_case, pence). */
const row = (over = {}) => ({
    id: 'tm-1',
    organisation_id: ORG,
    key: 'fullarch',
    label: 'Full Arch',
    unit: 'case',
    price_pence: 778_506,
    cbct_pence: 19_900,
    utilities_pence: 0,
    surgery_run_cost_pence: 60_000,
    lab_bill_pence: 350_000,
    marketing_pct: 10,
    lab_margin_pct: 30,
    dentist_pct: 40,
    target_margin_pct: 35,
    surgeries: 1,
    cases_per_surgery: 2,
    implants_per_patient: 1,
    components: [{ name: 'Implant', qty: 4, retailPence: 21_000, costPence: 10_500 }],
    is_custom: false,
    ...over,
});

beforeEach(() => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('treatmentModels — defaults, overridden by what the owner saved', () => {
    it('an org with nothing saved gets the built-ins, unchanged', async () => {
        const out = await svc.treatmentModels(ORG);
        expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_SERVICE_MODELS).sort());
        expect(out.fullarch.pricePence).toBe(DEFAULT_SERVICE_MODELS.fullarch.pricePence);
    });

    it('a saved row replaces that built-in, and only that one', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'treatment_models' ? { data: [row()], error: null } : { data: [], error: null };
        const out = await svc.treatmentModels(ORG);
        expect(out.fullarch.pricePence).toBe(778_506);          // the owner's figure
        expect(out.fullarch.labBillPence).toBe(350_000);
        expect(out.implant.pricePence).toBe(DEFAULT_SERVICE_MODELS.implant.pricePence); // untouched
    });

    it('a custom treatment appears alongside the built-ins', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'treatment_models'
                ? { data: [row({ key: 'bone-graft', label: 'Bone Graft', is_custom: true })], error: null }
                : { data: [], error: null };
        const out = await svc.treatmentModels(ORG);
        expect(out['bone-graft'].label).toBe('Bone Graft');
        expect(out['bone-graft'].isCustom).toBe(true);
        expect(Object.keys(out)).toHaveLength(Object.keys(DEFAULT_SERVICE_MODELS).length + 1);
    });

    it('a built-in override is not marked custom — it can be reset', async () => {
        // isCustom drives whether the UI offers "reset to default" or "delete".
        // Getting it wrong offers to reset a treatment that has no default and
        // would simply vanish.
        supaRec.resultProvider = (q) =>
            q.table === 'treatment_models' ? { data: [row()], error: null } : { data: [], error: null };
        const out = await svc.treatmentModels(ORG);
        expect(out.fullarch.isCustom).toBe(false);
    });

    it('reads are filtered to the caller organisation', async () => {
        // serviceClient bypasses RLS, so the explicit filter IS the isolation.
        const eqs = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'treatment_models') for (const e of q.eqs) eqs.push(e);
            return { data: [], error: null };
        };
        await svc.treatmentModels(ORG);
        expect(eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    });

    it('another org\'s rows can never be merged in', async () => {
        // Belt and braces on top of the filter above: even handed a foreign row,
        // the merge drops it rather than presenting it as this org's model.
        supaRec.resultProvider = (q) =>
            q.table === 'treatment_models'
                ? { data: [row({ organisation_id: OTHER_ORG, price_pence: 1 })], error: null }
                : { data: [], error: null };
        const out = await svc.treatmentModels(ORG);
        expect(out.fullarch.pricePence).toBe(DEFAULT_SERVICE_MODELS.fullarch.pricePence);
    });

    it('components survive the round trip as a list', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'treatment_models' ? { data: [row()], error: null } : { data: [], error: null };
        const out = await svc.treatmentModels(ORG);
        expect(Array.isArray(out.fullarch.components)).toBe(true);
        expect(out.fullarch.components[0]).toMatchObject({ name: 'Implant', qty: 4 });
    });

    it('a stored row with a malformed components column does not reach the compute', async () => {
        // The CHECK constraint refuses this at the boundary, but a row written
        // before it existed must not be iterated as though it were rows.
        supaRec.resultProvider = (q) =>
            q.table === 'treatment_models' ? { data: [row({ components: null })], error: null } : { data: [], error: null };
        const out = await svc.treatmentModels(ORG);
        expect(out.fullarch.components).toEqual([]);
    });
});

describe('saveTreatmentModel — the org is the caller\'s, never the payload\'s', () => {
    it('writes under the caller org even when the body names another', async () => {
        // A record that can name its own tenant is a cross-org write waiting to
        // happen (docs/ISOLATION_AUDIT.md).
        let written = null;
        supaRec.resultProvider = (q) => {
            if (q.table === 'treatment_models' && q.upsertVals) written = q.upsertVals;
            return { data: [row()], error: null };
        };
        await svc.saveTreatmentModel(ORG, 'fullarch', {
            organisationId: OTHER_ORG,
            label: 'Full Arch',
            unit: 'case',
            pricePence: 900_000,
            components: [],
        });
        expect(written).toBeTruthy();
        const payload = Array.isArray(written) ? written[0] : written;
        expect(payload.organisation_id).toBe(ORG);
    });

    it('marks a non-built-in key as custom, and a built-in key as not', async () => {
        const seen = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'treatment_models' && q.upsertVals) {
                seen.push(Array.isArray(q.upsertVals) ? q.upsertVals[0] : q.upsertVals);
            }
            return { data: [row()], error: null };
        };
        await svc.saveTreatmentModel(ORG, 'fullarch', { label: 'Full Arch', unit: 'case', components: [] });
        await svc.saveTreatmentModel(ORG, 'bone-graft', { label: 'Bone Graft', unit: 'case', components: [] });
        expect(seen[0].is_custom).toBe(false);
        expect(seen[1].is_custom).toBe(true);
    });
});
