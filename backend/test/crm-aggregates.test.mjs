// ============================================================================
// Elevate CRM server-side aggregates.
//
// These three screens each counted a CAPPED PAGE of rows in the browser and
// presented the result as the whole population. The tests that matter here are
// therefore not "does it add up" but "is the figure asked of the DATABASE, over
// the whole population, and scoped to ONE organisation" — because the old code
// added up perfectly, over the wrong rows.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { leadService } from '../src/services/lead.service.js';
import { commService, parseThreadKey } from '../src/services/comm.service.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const OWNER = { id: 'u-owner', role: 'owner' };

beforeEach(() => {
    supaRec.rpcCalls = [];
    supaRec.rpcProvider = null;
});

// ---------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------
describe('leadService.pipelineSummary', () => {
    const stages = [
        // 753 leads, only 69 of which carry any value: the case that made the
        // old board imply 753 leads were worth £78,487.
        { stage_id: 's1', lead_count: 753, valued_count: 69, value_pence: 7_848_700,
          open_count: 753, open_valued_count: 69, open_value_pence: 7_848_700 },
        // A fully closed stage: real value, but none of it is "active pipeline".
        { stage_id: 's2', lead_count: 524, valued_count: 492, value_pence: 52_815_000,
          open_count: 0, open_valued_count: 0, open_value_pence: 0 },
        // Nothing in this bucket carries a value at all.
        { stage_id: 's3', lead_count: 40, valued_count: 0, value_pence: 0,
          open_count: 40, open_valued_count: 0, open_value_pence: 0 },
    ];

    it('asks the database for the totals rather than summing rows it fetched', async () => {
        supaRec.rpcProvider = () => ({ data: stages, error: null });
        const r = await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        expect(supaRec.rpcCalls.map((c) => c.fn)).toEqual(['crm_pipeline_stage_summary']);
        expect(r.totals.lead_count).toBe(1317);
    });

    // The headline defect: £1.4m of pipeline rendering as £0.00 because the
    // valued leads were older than the page. The total must come from every
    // stage, not from whichever rows happened to be loaded.
    it('totals value across every stage', async () => {
        supaRec.rpcProvider = () => ({ data: stages, error: null });
        const r = await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        expect(r.totals.value_pence).toBe(60_663_700);
    });

    // "Active pipeline" must mean active. A closed-won stage holding £528k is
    // not money still in play, and the old board counted it as such.
    it('separates open value from total value', async () => {
        supaRec.rpcProvider = () => ({ data: stages, error: null });
        const r = await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        expect(r.totals.open_count).toBe(793);
        expect(r.totals.open_value_pence).toBe(7_848_700);
    });

    // THE BOARD MUST RECONCILE. The columns on screen are the stages, and the
    // header sits above them, so the stages have to add up to it — a panel
    // whose parts do not sum to its own total teaches people to distrust the
    // whole screen. This is asserted as an identity rather than against fixed
    // numbers, so it still holds when the fixture changes.
    it('the stages sum to the totals, exactly', async () => {
        supaRec.rpcProvider = () => ({ data: stages, error: null });
        const r = await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        const sum = (key) => r.stages.reduce((s, x) => s + (x[key] ?? 0), 0);
        expect(sum('lead_count')).toBe(r.totals.lead_count);
        expect(sum('value_pence')).toBe(r.totals.value_pence);
        expect(sum('valued_count')).toBe(r.totals.valued_count);
        expect(sum('open_count')).toBe(r.totals.open_count);
        expect(sum('open_value_pence')).toBe(r.totals.open_value_pence);
    });

    // NULL IS NOT ZERO. A stage where nothing carries a value has no value to
    // report; rendering £0.00 there states a fact nobody recorded.
    it('reports unrecorded value as null, never as zero', async () => {
        supaRec.rpcProvider = () => ({ data: stages, error: null });
        const r = await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        const s3 = r.stages.find((s) => s.stage_id === 's3');
        expect(s3.value_pence).toBeNull();
        expect(s3.valued_count).toBe(0);
        // …and the count of leads is still real.
        expect(s3.lead_count).toBe(40);
    });

    it('carries valued_count so a partial figure can say what it covers', async () => {
        supaRec.rpcProvider = () => ({ data: stages, error: null });
        const r = await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        const s1 = r.stages.find((s) => s.stage_id === 's1');
        expect(s1.lead_count).toBe(753);
        expect(s1.valued_count).toBe(69);
    });

    // An empty pipeline is a real state, not an error, and must not be
    // rendered as a zeroed board with confident totals.
    it('returns nulls, not zeroes, for a pipeline with no leads', async () => {
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const r = await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        expect(r.stages).toEqual([]);
        expect(r.totals.lead_count).toBe(0);
        expect(r.totals.value_pence).toBeNull();
    });

    it('does not query at all without a pipeline', async () => {
        const r = await leadService.pipelineSummary(ORG, { pipelineId: null });
        expect(supaRec.rpcCalls).toHaveLength(0);
        expect(r.totals).toBeNull();
    });

    // MULTI-TENANCY: the org reaches SQL as p_org and nothing else does.
    it('scopes the aggregate to the caller organisation', async () => {
        supaRec.rpcProvider = () => ({ data: stages, error: null });
        await leadService.pipelineSummary(ORG, { pipelineId: 'p1' });
        const params = supaRec.rpcCalls[0].params;
        expect(params.p_org).toBe(ORG);
        expect(JSON.stringify(params)).not.toContain(OTHER);
    });
});

// ---------------------------------------------------------------------------
// Today counters
// ---------------------------------------------------------------------------
describe('leadService.todayCounters', () => {
    it('returns the database counts, not the length of any page', async () => {
        supaRec.rpcProvider = () => ({
            data: [{ new_leads: 38, follow_ups: 12690, active_leads: 17778, inbound_messages: 20 }],
            error: null,
        });
        const r = await leadService.todayCounters(ORG, { since: '2026-09-07T00:00:00.000Z' });
        // 17,778 is the figure the old screen rendered as 500 — its page size.
        expect(r.active_leads).toBe(17778);
        expect(r.follow_ups).toBe(12690);
        expect(supaRec.rpcCalls[0].fn).toBe('crm_today_counters');
    });

    // The window belongs to the caller so the counter and the list beneath it
    // cannot disagree about where "today" starts.
    it('passes the window through to SQL, and null for all-time', async () => {
        supaRec.rpcProvider = () => ({ data: [{}], error: null });
        await leadService.todayCounters(ORG, { since: '2026-09-07T00:00:00.000Z' });
        expect(supaRec.rpcCalls[0].params.p_since).toBe('2026-09-07T00:00:00.000Z');
        await leadService.todayCounters(ORG, {});
        expect(supaRec.rpcCalls[1].params.p_since).toBeNull();
    });

    // An org with no leads yet must read zero rather than throw or show blanks.
    it('reads zero for an organisation with nothing yet', async () => {
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const r = await leadService.todayCounters(ORG, {});
        expect(r).toEqual({ new_leads: 0, follow_ups: 0, active_leads: 0, inbound_messages: 0 });
    });

    it('scopes to the caller organisation', async () => {
        supaRec.rpcProvider = () => ({ data: [{}], error: null });
        await leadService.todayCounters(ORG, {});
        expect(supaRec.rpcCalls[0].params.p_org).toBe(ORG);
    });
});

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
describe('commService.inbox', () => {
    const threads = [
        { thread_key: 'c:aaa', contact_id: 'aaa', lead_id: null, channel: 'sms',
          counterparty: '07000000000', contact_first_name: 'A', contact_last_name: 'B',
          last_at: '2026-09-07T10:00:00Z', last_subject: null, last_body: 'hi',
          message_count: 4, unread_count: 2, total_threads: 12768 },
    ];
    const summary = { total_messages: 169224, total_threads: 12768, unread_messages: 5753, unread_threads: 2611 };

    beforeEach(() => {
        supaRec.rpcProvider = (fn) => fn === 'crm_inbox_summary'
            ? { data: [summary], error: null }
            : { data: threads, error: null };
    });

    // The unread badge read 10 against a true 5,753 because it summed the
    // page. It must come from a count over the whole inbox.
    it('takes the unread badge from the whole inbox, not the page', async () => {
        const r = await commService.inbox(ORG, OWNER, {});
        expect(r.summary.unread_messages).toBe(5753);
        expect(r.threads).toHaveLength(1);
        // The page total must not be mistaken for the population.
        expect(r.summary.total_threads).toBe(12768);
    });

    // `total` answers "how many threads match this filter", which is what a
    // pager needs, and is distinct from the inbox-wide summary.
    it('reports the matching total from SQL, not the page length', async () => {
        const r = await commService.inbox(ORG, OWNER, { limit: 1 });
        expect(r.total).toBe(12768);
        expect(r.threads.length).toBeLessThan(r.total);
    });

    // Searching a page is not searching. The term has to reach SQL.
    it('sends the search term to the database', async () => {
        await commService.inbox(ORG, OWNER, { search: 'smith' });
        const call = supaRec.rpcCalls.find((c) => c.fn === 'crm_inbox_threads');
        expect(call.params.p_search).toBe('smith');
    });

    it('pages through parameters rather than slicing in memory', async () => {
        await commService.inbox(ORG, OWNER, { limit: 25, offset: 50 });
        const call = supaRec.rpcCalls.find((c) => c.fn === 'crm_inbox_threads');
        expect(call.params.p_limit).toBe(25);
        expect(call.params.p_offset).toBe(50);
    });

    // An empty inbox must not be reported as an empty PAGE of a full one.
    it('reports zero for an inbox with no messages', async () => {
        supaRec.rpcProvider = (fn) => fn === 'crm_inbox_summary'
            ? { data: [{ total_messages: 0, total_threads: 0, unread_messages: 0, unread_threads: 0 }], error: null }
            : { data: [], error: null };
        const r = await commService.inbox(ORG, OWNER, {});
        expect(r.total).toBe(0);
        expect(r.summary.unread_messages).toBe(0);
    });

    // SECURITY: the per-row visibility model that commRepository.list()
    // enforces must survive the move into SQL. If the viewer stopped reaching
    // the database, a reception user would start seeing owner-only messages —
    // a permissions regression hidden inside a performance fix.
    it('passes the viewer to SQL so visibility is not widened', async () => {
        await commService.inbox(ORG, { id: 'u-recep', role: 'reception' }, {});
        for (const call of supaRec.rpcCalls) {
            expect(call.params.p_viewer_role).toBe('reception');
            expect(call.params.p_viewer_id).toBe('u-recep');
        }
    });

    it('scopes every read to the caller organisation', async () => {
        await commService.inbox(ORG, OWNER, {});
        expect(supaRec.rpcCalls.length).toBeGreaterThan(0);
        for (const call of supaRec.rpcCalls) {
            expect(call.params.p_org).toBe(ORG);
            expect(JSON.stringify(call.params)).not.toContain(OTHER);
        }
    });
});

// ---------------------------------------------------------------------------
// Enquiries — the screen that was 100% mock
// ---------------------------------------------------------------------------
describe('leadService.enquiries', () => {
    const rows = [
        { lead_id: 'l1', created_at: '2026-08-01T00:00:00Z', contact_first_name: 'A',
          contact_last_name: 'B', contact_email: 'a@b.test', stage_name: 'New enquiry',
          status: 'new', estimated_value_pence: 250_000, source: 'Facebook',
          practice_name: 'Ashford', age_days: 38, total_count: 17778 },
        // No value recorded, and no practice mapped — both real states on live
        // data (77.5% and a whole tenant respectively).
        { lead_id: 'l2', created_at: '2026-08-02T00:00:00Z', contact_first_name: null,
          contact_last_name: null, contact_email: null, stage_name: null,
          status: 'contact_made', estimated_value_pence: null, source: null,
          practice_name: null, age_days: 37, total_count: 17778 },
    ];
    const summary = { open_count: 17778, valued_count: 2772, value_pence: 637_938_011,
                      stale_count: 17042, oldest_age_days: 843 };

    beforeEach(() => {
        supaRec.rpcProvider = (fn) => fn === 'crm_enquiries_summary'
            ? { data: [summary], error: null }
            : { data: rows, error: null };
    });

    it('takes the total from SQL, not from the page it was handed', async () => {
        const r = await leadService.enquiries(ORG, { limit: 2 });
        expect(r.total).toBe(17778);
        expect(r.enquiries).toHaveLength(2);
        expect(r.summary.open_count).toBe(17778);
    });

    // NULL IS NOT ZERO — the single most repeated defect on these screens.
    it('keeps an unrecorded value null rather than rendering it as zero', async () => {
        const r = await leadService.enquiries(ORG, {});
        expect(r.enquiries[0].estimated_value_pence).toBe(250_000);
        expect(r.enquiries[1].estimated_value_pence).toBeNull();
    });

    it('reports no total value at all when nothing carries one', async () => {
        supaRec.rpcProvider = (fn) => fn === 'crm_enquiries_summary'
            ? { data: [{ ...summary, valued_count: 0, value_pence: 0 }], error: null }
            : { data: [], error: null };
        const r = await leadService.enquiries(ORG, {});
        expect(r.summary.value_pence).toBeNull();
        expect(r.total).toBe(0);
    });

    // The mock's "Treatment" column read leads.treatment, which carries patient
    // emails and phone numbers on live data. It must not come back.
    it('never returns a treatment field', async () => {
        const r = await leadService.enquiries(ORG, {});
        for (const e of r.enquiries) {
            expect(e).not.toHaveProperty('treatment');
        }
        expect(JSON.stringify(r)).not.toMatch(/treatment/i);
    });

    it('passes search and paging to SQL', async () => {
        await leadService.enquiries(ORG, { search: 'ash', limit: 25, offset: 75 });
        const call = supaRec.rpcCalls.find((c) => c.fn === 'crm_enquiries');
        expect(call.params.p_search).toBe('ash');
        expect(call.params.p_limit).toBe(25);
        expect(call.params.p_offset).toBe(75);
    });

    it('scopes every read to the caller organisation', async () => {
        await leadService.enquiries(ORG, {});
        expect(supaRec.rpcCalls.length).toBeGreaterThan(0);
        for (const call of supaRec.rpcCalls) {
            expect(call.params.p_org).toBe(ORG);
            expect(JSON.stringify(call.params)).not.toContain(OTHER);
        }
    });
});

// ---------------------------------------------------------------------------
// Thread keys
// ---------------------------------------------------------------------------
describe('parseThreadKey', () => {
    it('reads a contact thread', () => {
        expect(parseThreadKey('c:abc')).toEqual({ contactId: 'abc' });
    });
    it('reads a lead thread', () => {
        expect(parseThreadKey('l:xyz')).toEqual({ leadId: 'xyz' });
    });
    // An email address contains no colon, but the key format allows one and a
    // naive split() would truncate the address and silently open the wrong
    // conversation.
    it('keeps a counterparty address containing a colon intact', () => {
        expect(parseThreadKey('a:email:a:b@x.com'))
            .toEqual({ channel: 'email', counterparty: 'a:b@x.com' });
    });
    it('refuses anything it does not recognise', () => {
        for (const bad of ['', 'x', 'zzz:1', 'a:nocolon', null, undefined, 42]) {
            expect(parseThreadKey(bad)).toBeNull();
        }
    });
});

describe('commService.thread', () => {
    it('refuses an unparseable conversation key rather than reading broadly', async () => {
        await expect(commService.thread(ORG, OWNER, 'garbage')).rejects.toThrow(/Unknown conversation/);
    });
});

// ---------------------------------------------------------------------------
// Wiring.
//
// `npm run typecheck` here is `node --check`, which PARSES without evaluating —
// it cannot see an undefined handler or a schema referenced before it exists.
// A route file has already shipped in this repo whose module threw on import
// while typecheck, lint and build all passed. Importing the modules is the
// only check that catches it.
// ---------------------------------------------------------------------------
describe('routes are mounted and their handlers exist', () => {
    it('mounts the new leads reads', async () => {
        const router = (await import('../src/routes/leads.routes.js')).default;
        const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
        expect(paths).toContain('/pipeline-summary');
        expect(paths).toContain('/today-counters');
        expect(paths).toContain('/enquiries');
        expect(paths.indexOf('/enquiries')).toBeLessThan(paths.indexOf('/:id'));
        // Static paths must be registered BEFORE /:id or the param route
        // swallows them and both endpoints 404 into an empty screen.
        expect(paths.indexOf('/pipeline-summary')).toBeLessThan(paths.indexOf('/:id'));
        expect(paths.indexOf('/today-counters')).toBeLessThan(paths.indexOf('/:id'));
    });

    it('mounts the new inbox reads', async () => {
        const router = (await import('../src/routes/comms.routes.js')).default;
        const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
        expect(paths).toContain('/inbox');
        expect(paths).toContain('/thread');
    });

    it('every handler the routes name actually exists', async () => {
        const { leadController } = await import('../src/controllers/lead.controller.js');
        const { commController } = await import('../src/controllers/comm.controller.js');
        expect(typeof leadController.pipelineSummary).toBe('function');
        expect(typeof leadController.todayCounters).toBe('function');
        expect(typeof leadController.enquiries).toBe('function');
        expect(typeof commController.inbox).toBe('function');
        expect(typeof commController.thread).toBe('function');
    });

    // The browser may choose a page size; it may not choose an unbounded one.
    it('caps a client-chosen page size instead of trusting it', async () => {
        const { commInboxQuerySchema } = await import('../src/models/comm.model.js');
        expect(() => commInboxQuerySchema.parse({ limit: '999' })).toThrow();
        expect(commInboxQuerySchema.parse({ limit: '25' }).limit).toBe(25);
        expect(commInboxQuerySchema.parse({}).limit).toBe(50);
    });

    // A summary with no pipeline would aggregate every pipeline in the org
    // into one meaningless total — refuse it rather than answer it.
    it('refuses a pipeline summary with no pipeline named', async () => {
        const { pipelineSummaryQuerySchema } = await import('../src/models/lead.model.js');
        expect(() => pipelineSummaryQuerySchema.parse({})).toThrow();
        expect(pipelineSummaryQuerySchema.parse({ ghl_pipeline_id: 'p1' }).ghl_pipeline_id).toBe('p1');
    });
});
