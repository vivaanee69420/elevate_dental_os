// Marketing route wiring: the permission key exists, the feature key exists,
// and Reception can never reach it (project rule 5 — Reception is CRM-only).
import { describe, it, expect } from 'vitest';
const { PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS } = await import('../src/lib/permissions.js');
const { FEATURE_CATALOG } = await import('../src/lib/features.js');
const marketingRouter = (await import('../src/routes/marketing.routes.js')).default;

describe('marketing gating', () => {
    it('registers a marketing.view permission', () => {
        expect(PERMISSION_CATALOG).toHaveProperty('marketing.view');
    });
    it('registers a marketing module feature defaulting ON with its nav section', () => {
        expect(FEATURE_CATALOG.marketing).toMatchObject({
            kind: 'module', default: true, navSection: 'Marketing',
        });
    });
    it('grants marketing.view to practice_manager but NEVER to reception', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['marketing.view']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.reception['marketing.view']).toBeUndefined();
    });
    it('owner keeps everything, marketing included', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.owner['marketing.view']).toBe(true);
    });
});

// Fix round 1: the route MUST be gated with requirePermission('marketing.view'),
// not requireRole('owner', 'practice_manager') — otherwise the permission key
// is decorative and the Team Permissions matrix toggle has zero effect.
// Rather than assert on middleware identity (auth.js attaches no structural
// hook to requireRole/requirePermission the way requireFeature attaches
// .featureKey), this drives the ACTUAL guard on the route with synthetic
// req/res objects and asserts on its behaviour — which is what would
// actually regress if someone swapped the gate back to requireRole.
function mockRes() {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
}

function performanceGuard() {
    const layer = marketingRouter.stack.find((l) => l.route?.path === '/performance');
    if (!layer) throw new Error('GET /performance route not found');
    // Everything before the final handler is a gate; the permission gate is
    // the only middleware on this route, so it is stack[0].
    return layer.route.stack[0].handle;
}

describe('marketing route guard is permission-based, not role-based', () => {
    it('denies a practice_manager with no marketing.view permission (role alone must not grant access)', () => {
        const guard = performanceGuard();
        const req = { user: { role: 'practice_manager', permissions: {} } };
        const res = mockRes();
        let nextCalled = false;
        guard(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(403);
    });
    it('grants a reception user that DOES carry marketing.view (permission, not role, decides)', () => {
        // This can never happen via DEFAULT_ROLE_PERMISSIONS (reception never
        // gets the key) but an owner override in the Team Permissions matrix
        // must still work — proving the gate reads req.user.permissions.
        const guard = performanceGuard();
        const req = { user: { role: 'reception', permissions: { 'marketing.view': true } } };
        const res = mockRes();
        let nextCalled = false;
        guard(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });
});

describe('leads query validation', () => {
    it('accepts campaignId as a free-text platform id, not a uuid', async () => {
        // ad_campaign_id is Google's or Meta's OWN id: '120249721894530517' is
        // a real one. Validating it as a uuid would reject every live campaign
        // and the filter would silently never match.
        const { LeadListQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = LeadListQuerySchema.parse({
            since: '2026-07-31T23:00:00.000Z',
            until: '2026-08-31T23:00:00.000Z',
            scope: 'all',
            campaignId: '120249721894530517',
        });
        expect(parsed.campaignId).toBe('120249721894530517');
    });

    it('rejects an over-long campaignId', async () => {
        const { LeadListQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => LeadListQuerySchema.parse({
            since: '2026-07-31T23:00:00.000Z',
            until: '2026-08-31T23:00:00.000Z',
            campaignId: 'x'.repeat(129),
        })).toThrow();
    });

    it('leaves campaignId optional — the unfiltered list still validates', async () => {
        const { LeadListQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = LeadListQuerySchema.parse({
            since: '2026-07-31T23:00:00.000Z',
            until: '2026-08-31T23:00:00.000Z',
        });
        expect(parsed.campaignId).toBeUndefined();
    });
});

describe('reconciliation query validation', () => {
    // since/until are OPTIONAL, and omitting them is the intended use: the
    // panel used to compute this window from its own UTC clock while the sync
    // computes it in LONDON, so through BST the two disagreed for the hour
    // after midnight and the panel asked for a day that existed in ad_metrics
    // but could not yet exist in the deep tables — a whole day of campaign
    // spend on one side of the comparison only. The server now fills the
    // window in with the same londonDaysAgo(DEEP_WINDOW_DAYS)/londonYmd() the
    // sync uses. Parsing must therefore SUCCEED with neither present, and the
    // schema must leave them undefined rather than inventing a value.
    it('accepts a query with neither since nor until — the server supplies the London window', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = ReconciliationQuerySchema.parse({ provider: 'meta_ads' });
        expect(parsed).toEqual({ provider: 'meta_ads' });
        expect(parsed.since).toBeUndefined();
        expect(parsed.until).toBeUndefined();
    });

    it('accepts an entirely empty query, defaulting the provider', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = ReconciliationQuerySchema.parse({});
        expect(parsed.provider).toBe('google_ads');
        expect(parsed.since).toBeUndefined();
    });

    it('accepts one bound without the other', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(ReconciliationQuerySchema.parse({ until: '2026-08-31' }).until).toBe('2026-08-31');
        expect(ReconciliationQuerySchema.parse({ since: '2026-06-01' }).since).toBe('2026-06-01');
    });

    // Optional does NOT mean unvalidated: a present-but-malformed bound is
    // still a client bug and must fail loudly rather than fall back to the
    // default window, which would silently answer a different question.
    it('rejects a malformed since (single-digit month/day, not zero-padded)', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => ReconciliationQuerySchema.parse({
            since: '2026-8-1', until: '2026-08-31',
        })).toThrow();
    });

    it('rejects a malformed until (not a date at all)', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => ReconciliationQuerySchema.parse({
            since: '2026-06-01', until: 'not-a-date',
        })).toThrow();
    });

    it('rejects an unknown provider', async () => {
        // Only google_ads and meta_ads have a deep-grain pull (Task 4) to
        // reconcile against — any other value must fail before it reaches
        // the service's LEVELS[provider] lookup.
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => ReconciliationQuerySchema.parse({
            since: '2026-06-01', until: '2026-08-31', provider: 'tiktok_ads',
        })).toThrow();
    });

    it('accepts a well-formed google_ads query', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = ReconciliationQuerySchema.parse({
            since: '2026-06-01', until: '2026-08-31', provider: 'google_ads',
        });
        expect(parsed).toEqual({ since: '2026-06-01', until: '2026-08-31', provider: 'google_ads' });
    });

    it('accepts a well-formed meta_ads query', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = ReconciliationQuerySchema.parse({
            since: '2026-06-01', until: '2026-08-31', provider: 'meta_ads',
        });
        expect(parsed).toEqual({ since: '2026-06-01', until: '2026-08-31', provider: 'meta_ads' });
    });

    it('defaults provider to google_ads when omitted', async () => {
        const { ReconciliationQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = ReconciliationQuerySchema.parse({ since: '2026-06-01', until: '2026-08-31' });
        expect(parsed.provider).toBe('google_ads');
    });
});

// Same optional-window idiom as reconciliation (Task 4's brief): the Facebook
// report windows since/until server-side from the SAME londonDaysAgo/
// londonYmd helpers the sync uses, so the client and server can never
// compute the window on different clocks.
describe('facebook query validation', () => {
    it('accepts an omitted window and lets the server default it', async () => {
        const { FacebookQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = FacebookQuerySchema.parse({});
        expect(parsed.since).toBeUndefined();
        expect(parsed.until).toBeUndefined();
    });

    it('still rejects a malformed date when one IS supplied', async () => {
        const { FacebookQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => FacebookQuerySchema.parse({ since: '2026-8-1' })).toThrow();
        expect(() => FacebookQuerySchema.parse({ until: 'not-a-date' })).toThrow();
    });

    it('accepts a well-formed window and an optional cursor', async () => {
        const { FacebookQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = FacebookQuerySchema.parse({ since: '2026-06-01', until: '2026-08-31', cursor: '50' });
        expect(parsed).toEqual({ since: '2026-06-01', until: '2026-08-31', cursor: '50' });
    });

    // M1: an org id must never be accepted from the request. Under an agency
    // switch req.user.organisation_id is already the sub-account's id;
    // accepting one from the query string would let any authenticated user
    // read another tenant's ad spend.
    it('has no organisation field', async () => {
        const { FacebookQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = FacebookQuerySchema.parse({ organisation_id: 'other-org' });
        expect(parsed.organisation_id).toBeUndefined();
    });

    // Defence in depth: an inverted range reaches campaignSpendByProvider's
    // .gte(since).lte(until), matches nothing, and campaigns() cannot tell
    // "no rows" from "never synced" — so it reports state: 'never_synced' to
    // a fully synced tenant. A client bug that produced exactly this was
    // found and fixed elsewhere in this plan, which is why the guard exists.
    it('rejects an inverted range (since after until)', async () => {
        const { FacebookQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => FacebookQuerySchema.parse({ since: '2026-08-31', until: '2026-06-01' })).toThrow();
    });

    // A single-day selection (since === until) is a legitimate request, not
    // an inverted range — rejecting it would break the day view.
    it('accepts an equal since and until (a single-day selection)', async () => {
        const { FacebookQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = FacebookQuerySchema.parse({ since: '2026-07-15', until: '2026-07-15' });
        expect(parsed).toEqual({ since: '2026-07-15', until: '2026-07-15' });
    });

    // The refinement must only apply when BOTH fields are present — since or
    // until alone is filled in server-side and can never be self-inverted.
    it('does not require until when since is present alone, and vice versa', async () => {
        const { FacebookQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => FacebookQuerySchema.parse({ since: '2026-08-31' })).not.toThrow();
        expect(() => FacebookQuerySchema.parse({ until: '2026-06-01' })).not.toThrow();
    });
});

// Same shared-schema idiom as FacebookQuerySchema above (Task 4's brief):
// campaignId and parentId are both optional filters used by different Google
// routes (parentId is an ad GROUP's own id — never a campaign id — when it
// narrows /ads or /keywords, which are SIBLINGS under an ad group).
describe('google query validation', () => {
    it('accepts an omitted window and lets the server default it', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = GoogleQuerySchema.parse({});
        expect(parsed.since).toBeUndefined();
        expect(parsed.until).toBeUndefined();
    });

    it('still rejects a malformed date when one IS supplied', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => GoogleQuerySchema.parse({ since: '2026-8-1' })).toThrow();
        expect(() => GoogleQuerySchema.parse({ until: 'not-a-date' })).toThrow();
    });

    it('accepts a well-formed window plus campaignId, parentId and cursor', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = GoogleQuerySchema.parse({
            since: '2026-06-01', until: '2026-08-31', campaignId: 'CMP1', parentId: 'AG1', cursor: '50',
        });
        expect(parsed).toEqual({
            since: '2026-06-01', until: '2026-08-31', campaignId: 'CMP1', parentId: 'AG1', cursor: '50',
        });
    });

    // M1: an org id must never be accepted from the request — same reasoning
    // as FacebookQuerySchema's identical test.
    it('has no organisation field', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = GoogleQuerySchema.parse({ organisation_id: 'other-org' });
        expect(parsed.organisation_id).toBeUndefined();
    });

    it('rejects an inverted range (since after until)', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => GoogleQuerySchema.parse({ since: '2026-08-31', until: '2026-06-01' })).toThrow();
    });

    it('accepts an equal since and until (a single-day selection)', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = GoogleQuerySchema.parse({ since: '2026-07-15', until: '2026-07-15' });
        expect(parsed).toEqual({ since: '2026-07-15', until: '2026-07-15' });
    });

    it('does not require until when since is present alone, and vice versa', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => GoogleQuerySchema.parse({ since: '2026-08-31' })).not.toThrow();
        expect(() => GoogleQuerySchema.parse({ until: '2026-06-01' })).not.toThrow();
    });

    it('rejects an over-long campaignId or parentId', async () => {
        const { GoogleQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => GoogleQuerySchema.parse({ campaignId: 'x'.repeat(129) })).toThrow();
        expect(() => GoogleQuerySchema.parse({ parentId: 'x'.repeat(129) })).toThrow();
    });
});

// Google routes: four flat, query-filtered routes (campaigns/ad-groups/ads/
// keywords) under the same marketing.view permission as the Facebook routes.
describe('google routes are registered and permission-gated', () => {
    it('registers all four Google routes', () => {
        const paths = marketingRouter.stack.filter((l) => l.route).map((l) => l.route.path);
        expect(paths).toEqual(expect.arrayContaining([
            '/google/campaigns', '/google/ad-groups', '/google/ads', '/google/keywords',
        ]));
    });

    it('denies a practice_manager with no marketing.view permission on every Google route', () => {
        for (const path of ['/google/campaigns', '/google/ad-groups', '/google/ads', '/google/keywords']) {
            const layer = marketingRouter.stack.find((l) => l.route?.path === path);
            const guard = layer.route.stack[0].handle;
            const req = { user: { role: 'practice_manager', permissions: {} } };
            const res = mockRes();
            let nextCalled = false;
            guard(req, res, () => { nextCalled = true; });
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(403);
        }
    });

    it('grants a user carrying marketing.view on every Google route', () => {
        for (const path of ['/google/campaigns', '/google/ad-groups', '/google/ads', '/google/keywords']) {
            const layer = marketingRouter.stack.find((l) => l.route?.path === path);
            const guard = layer.route.stack[0].handle;
            const req = { user: { role: 'practice_manager', permissions: { 'marketing.view': true } } };
            const res = mockRes();
            let nextCalled = false;
            guard(req, res, () => { nextCalled = true; });
            expect(nextCalled).toBe(true);
        }
    });
});
