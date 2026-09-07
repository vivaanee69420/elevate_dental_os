// The Facebook report reads its leads through TWO functions — ad_meta_funnel
// for the Campaigns / Ad sets / Ads tabs, ad_meta_lead_ledger for the
// performance panel's cards above them. They must select the SAME people.
//
// They did not, for a while, and the symptom was invisible: 000171 moved the
// ledger onto the pipeline pool and left ad_meta_funnel on the older structural
// test (ad_campaign_id resolving to a Meta campaign in ad_metrics). Measured on
// live data at the point it was found, the two returned 2,171 and 2,172 leads —
// one apart, and built from different sets of people. A number that close is
// exactly why nobody noticed.
//
// Both are plpgsql, so this asserts on the migration SQL rather than by running
// it. That is a weaker test than executing both against a fixture, and it is
// here because the failure it guards against is a SILENT DIVERGENCE between two
// files that no unit test would ever touch.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), '..', 'supabase', 'migrations');

/** The migration that most recently defines `fn`, by ledger order. */
function latestDefining(fn) {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    const hit = files.filter((f) => new RegExp(`FUNCTION public\\.${fn}\\s*\\(`).test(readFileSync(join(DIR, f), 'utf8')));
    expect(hit.length, `no migration defines ${fn}`).toBeGreaterThan(0);
    return readFileSync(join(DIR, hit.at(-1)), 'utf8');
}

describe('ad_meta_funnel and ad_meta_lead_ledger select the same leads', () => {
    const funnel = latestDefining('ad_meta_funnel');
    const ledger = latestDefining('ad_meta_lead_ledger');

    // The owner's rule, stated twice on 2026-09-08: a lead belongs to the
    // channel its PIPELINE is mapped to, whatever its own record says.
    it('both take their pool from the pipeline mapping', () => {
        for (const [name, sql] of [['funnel', funnel], ['ledger', ledger]]) {
            expect(sql, `${name} must read ad_channel_pipelines`).toContain('ad_channel_pipelines');
            expect(sql, `${name} must select the meta_ads channel`).toMatch(/channel\s*=\s*'meta_ads'/);
        }
    });

    // An open-day pipeline counts WITHOUT a channel mapping (000170), so that a
    // half-finished mapping still reports correctly. A first cut of 000179 used
    // channel='meta_ads' alone and would have dropped every open-day lead from
    // the tabs while the cards kept them — one disagreement traded for another.
    it('both include open-day pipelines, not just channel-mapped ones', () => {
        for (const [name, sql] of [['funnel', funnel], ['ledger', ledger]]) {
            expect(sql, `${name} must include ad_open_day_pipelines`).toContain('ad_open_day_pipelines');
        }
    });

    // The rule this replaced. Membership must not be decided by whether the
    // lead's campaign id resolves to a Meta campaign — that made META the
    // arbiter of which leads exist, when every Facebook lead reaches this
    // system through GoHighLevel and Meta supplies only spend.
    it('neither decides MEMBERSHIP by resolving the campaign id against ad_metrics', () => {
        // Naming a Meta campaign is still fine and both do it — the ban is on
        // using that resolution as a WHERE filter over the lead pool.
        const structuralFilter = /IN\s*\(\s*SELECT\s+m\.campaign_id\s+FROM\s+ad_metrics/i;
        expect(structuralFilter.test(funnel), 'funnel still filters the pool structurally').toBe(false);
        expect(structuralFilter.test(ledger), 'ledger still filters the pool structurally').toBe(false);
    });

    // A lead with no campaign id is still a Meta lead; it simply cannot be
    // placed in a campaign ROW. Dropping it would make the tabs sum to fewer
    // leads than the card above them, which is the reconciliation failure
    // 000165 spelled out for the Google side.
    it('does not require a campaign id to enter the funnel', () => {
        expect(funnel).not.toMatch(/WHERE\s+f\.ad_campaign_id\s+IS\s+NOT\s+NULL/i);
    });
});
