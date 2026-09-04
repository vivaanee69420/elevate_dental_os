// googleLeadLedger — the repository boundary for the Google report's blended
// CPL/CPB/CPA cards (migrations 000158, 000162).
//
// The acceptance RULE lives in SQL and is exercised against real rows by
// scripts/google-lead-ledger-check.sql — that is deliberate, because the
// defects this pairing exists to catch (comparing an instant to a
// date-only feed; ordering DISTINCT ON by a column that picks a £0.00 line)
// all type-check, run, and answer the wrong question in silence. No mock can
// see them. What IS testable here is the contract around that SQL: the floor
// reaches it, and the money it returns reaches the caller.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { marketingRepository } = await import('../src/repositories/marketing.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

const ROW = {
    phone10: '7432810297', practice_id: 'P1', practice_name: 'Barnet', source: 'ghl',
    lead_at: '2026-07-11T09:00:00Z', name: 'faith cousins', email: 'f@x.com',
    treatment: 'Exam & Scale & Polish', booked: true, accepted: true,
    is_new_patient: true, paid_pence: 8900,
};

beforeEach(() => {
    supaRec.rpcCalls = [];
    // One page of rows then an empty one. The reader stops on an EMPTY page,
    // never a short one, so a provider that returned the same rows forever
    // would spin to its page cap rather than fail — see the "vitest .rpc()
    // mock has no range slicing" note.
    let served = false;
    supaRec.rpcProvider = () => {
        const data = served ? [] : [ROW];
        served = true;
        return { data, error: null };
    };
});

// The probe this removes cost more than the query it was probing: measured on
// the live org, the ledger is ~16ms warm and the extra "is there another page"
// request was 1,570ms, because PostgREST re-runs the whole function and then
// discards every row through OFFSET. These two tests pin BOTH paths — the fast
// one and the fallback — because the fallback is what keeps it correct if the
// count ever stops arriving.
describe('googleLeadLedger — paging', () => {
    it('makes ONE request when the server reports the total', async () => {
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = () => ({ data: [ROW, { ...ROW, phone10: '7989401412' }], error: null, count: 2 });
        const rows = await marketingRepository.googleLeadLedger(ORG, '2026-06-01', '2026-09-01', 4000);
        expect(rows).toHaveLength(2);
        expect(supaRec.rpcCalls.filter((c) => c.fn === 'ad_google_lead_ledger')).toHaveLength(1);
    });

    // No count (older PostgREST, or a shape that cannot report one) must not
    // silently truncate. It falls back to the original rule — keep going until
    // a page comes back EMPTY — which costs the extra request but is never wrong.
    it('falls back to the empty-page rule when no count is reported', async () => {
        supaRec.rpcCalls = [];
        let served = false;
        supaRec.rpcProvider = () => {
            const data = served ? [] : [ROW];
            served = true;
            return { data, error: null };
        };
        const rows = await marketingRepository.googleLeadLedger(ORG, '2026-06-01', '2026-09-01', 4000);
        expect(rows).toHaveLength(1);
        expect(supaRec.rpcCalls.filter((c) => c.fn === 'ad_google_lead_ledger')).toHaveLength(2);
    });

    // A FULL page with more behind it must still page on — the count is what
    // says we are done, never the fact that a page arrived.
    it('keeps paging while the count says there is more', async () => {
        supaRec.rpcCalls = [];
        let call = 0;
        supaRec.rpcProvider = () => {
            call += 1;
            if (call === 1) return { data: [ROW, ROW], error: null, count: 3 };
            return { data: [ROW], error: null, count: 3 };
        };
        const rows = await marketingRepository.googleLeadLedger(ORG, '2026-06-01', '2026-09-01', 4000);
        expect(rows).toHaveLength(3);
        expect(supaRec.rpcCalls.filter((c) => c.fn === 'ad_google_lead_ledger')).toHaveLength(2);
    });
});

describe('googleLeadLedger', () => {
    // Passed explicitly, never left to the RPC's own DEFAULT: the caller owns
    // the tenant's consultation fee, and a server-side default the caller
    // never states is how the label on the card and the number behind it
    // drift apart.
    it('sends the acceptance floor as a parameter', async () => {
        await marketingRepository.googleLeadLedger(ORG, '2026-06-01', '2026-09-01', 4000);
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_google_lead_ledger');
        expect(call.params).toEqual({
            p_org: ORG, p_since: '2026-06-01', p_until: '2026-09-01', p_min_paid_pence: 4000,
        });
    });

    // The org is never a caller-supplied field on the row; it is the first
    // parameter and nothing else. serviceClient bypasses RLS, so p_org IS
    // the tenant boundary.
    it('scopes every call to the org it was given', async () => {
        const OTHER = '99999999-9999-9999-9999-999999999999';
        await marketingRepository.googleLeadLedger(OTHER, '2026-06-01', '2026-09-01', 4000);
        expect(supaRec.rpcCalls.every((c) => c.params.p_org === OTHER)).toBe(true);
    });

    // paid_pence is what makes `accepted` auditable on screen. Dropping it
    // in the mapping would leave the drill-down showing a bare "Yes" whose
    // threshold the reader cannot check — which is how a £0.00 line came to
    // be labelled as someone's treatment in the first place.
    it('carries the amount paid through to the caller', async () => {
        const rows = await marketingRepository.googleLeadLedger(ORG, '2026-06-01', '2026-09-01', 4000);
        expect(rows).toHaveLength(1);
        expect(rows[0].paid_pence).toBe(8900);
        expect(rows[0].accepted).toBe(true);
        expect(rows[0].treatment).toBe('Exam & Scale & Polish');
    });

    // paid_pence is NET of refunds, so it can legitimately be negative — a
    // refund landing in the window for something paid before the lead. It
    // must survive as a negative rather than being clamped or dropped:
    // clamped to 0 the row would read "paid nothing", which is a different
    // and false claim about a patient who was refunded.
    it('carries a refund-negative amount through unchanged', async () => {
        supaRec.rpcProvider = (() => {
            let served = false;
            return () => {
                const data = served ? [] : [{ ...ROW, accepted: false, paid_pence: -4500 }];
                served = true;
                return { data, error: null };
            };
        })();
        const rows = await marketingRepository.googleLeadLedger(ORG, '2026-06-01', '2026-09-01', 4000);
        expect(rows[0].paid_pence).toBe(-4500);
        expect(rows[0].accepted).toBe(false);
    });

    // 0 is a real answer — this lead paid nothing, or paid and was refunded
    // in full — and must survive as 0. Coerced to null it would render as an
    // em dash, i.e. "unknown", which is a different and false claim.
    it('reports a lead that paid nothing as 0, not null', async () => {
        supaRec.rpcProvider = (() => {
            let served = false;
            return () => {
                const data = served ? [] : [{ ...ROW, accepted: false, paid_pence: 0 }];
                served = true;
                return { data, error: null };
            };
        })();
        const rows = await marketingRepository.googleLeadLedger(ORG, '2026-06-01', '2026-09-01', 4000);
        expect(rows[0].paid_pence).toBe(0);
        expect(rows[0].accepted).toBe(false);
    });
});
