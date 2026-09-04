// Marketing data access — queries in, rows out. No logic here.
// serviceClient has NO automatic isolation: every query filters
// organisation_id explicitly (rule 3).
import * as supabase_1 from '../lib/supabase.js';
import { londonYmd } from '../lib/tz.js';

export const marketingRepository = {
    // Spend per campaign per provider over the window. ad_metrics is campaign x
    // day; this collapses it to campaign. Paginated: PostgREST caps reads at
    // 1000 rows and a 6-month window across several accounts exceeds that.
    async campaignSpend(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const out = [];
        for (let from = 0; ; from += PAGE) {
            let q = supabase_1.serviceClient
                .from('ad_metrics')
                .select('provider, customer_id, campaign_id, campaign_name, practice_id, metric_date, spend_pence, impressions, clicks, conversions')
                .eq('organisation_id', orgId)
                // metric_date is a DATE while the scope window is an ISO
                // instant with an EXCLUSIVE until. The instant must be resolved
                // to its LONDON calendar date, never sliced: the scope bar emits
                // 2026-07-31T23:00:00Z for the start of August under BST, and a
                // slice would read that as 31 July — pulling in a day of July
                // spend and, at the other end, excluding 31 August. Spend and
                // ad_lead_conversions would then be measured over different
                // days and every cost-per-lead figure would be wrong. The
                // half-open comparison itself is right and is kept.
                .gte('metric_date', londonYmd(since))
                .lt('metric_date', londonYmd(until))
                .range(from, from + PAGE - 1);
            if (practiceId) q = q.eq('practice_id', practiceId);
            const { data, error } = await q;
            if (error) throw new Error(`ad_metrics read: ${error.message}`);
            const rows = data ?? [];
            out.push(...rows);
            if (rows.length < PAGE) break;
        }
        // Spend that belongs to no practice: the account it was bought on has
        // no practice mapping. It is real spend and stays in the group total,
        // but it can never appear under a practice — so the screen must be able
        // to say so rather than let a practice quietly read low.
        const unmappedSpendPence = out.reduce(
            (n, r) => (r.practice_id ? n : n + Number(r.spend_pence ?? 0)), 0);

        // Spend per practice, for the comparison screen. Built here because the
        // campaign collapse discards practice_id — a campaign can only belong
        // to one account and therefore one practice, but the collapsed row does
        // not carry it.
        const spendByPractice = new Map();
        for (const r of out) {
            const k = r.practice_id ?? null;
            spendByPractice.set(k, (spendByPractice.get(k) ?? 0) + Number(r.spend_pence ?? 0));
        }

        // Daily series for the trend, built from the SAME rows as the campaign
        // collapse so the chart and the tiles can never disagree.
        const byDay = new Map();
        for (const r of out) {
            const d = r.metric_date;
            if (!d) continue;
            const e = byDay.get(d) ?? { date: d, spendPence: 0, google_ads: 0, meta_ads: 0 };
            const spend = Number(r.spend_pence ?? 0);
            e.spendPence += spend;
            if (r.provider === 'google_ads' || r.provider === 'meta_ads') e[r.provider] += spend;
            byDay.set(d, e);
        }
        const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

        // Collapse campaign x day -> campaign.
        const byCampaign = new Map();
        for (const r of out) {
            const k = `${r.provider}|${r.campaign_id}`;
            const e = byCampaign.get(k) ?? {
                provider: r.provider, customer_id: r.customer_id, campaign_id: r.campaign_id,
                campaign_name: r.campaign_name, spend_pence: 0, impressions: 0, clicks: 0, conversions: 0,
            };
            e.spend_pence += Number(r.spend_pence ?? 0);
            e.impressions += Number(r.impressions ?? 0);
            e.clicks += Number(r.clicks ?? 0);
            e.conversions += Number(r.conversions ?? 0);
            if (!e.campaign_name && r.campaign_name) e.campaign_name = r.campaign_name;
            byCampaign.set(k, e);
        }
        return {
            campaigns: [...byCampaign.values()],
            series,
            unmappedSpendPence,
            spendByPractice: [...spendByPractice.entries()],
        };
    },

    // Raw ad_metrics rows for ONE provider over a window, for the reconciliation
    // service to sum. Deliberately NOT campaignSpend(): that method resolves its
    // window to LONDON calendar dates for the shared ScopePeriod bar and bounds
    // it HALF-OPEN (`gte`/`lt`), while the ad_grain_rollup RPC this feeds
    // compares plain dates INCLUSIVE on both ends (`>= since AND <= until`).
    // Reusing campaignSpend would silently drop the final day's spend from one
    // side of every comparison and report a permanent false gap on the very
    // feature built to prove the numbers tally — so `since`/`until` here are
    // taken as plain YYYY-MM-DD strings, never routed through londonYmd, and
    // bounded with `.gte()`/`.lte()` to match the RPC exactly.
    //
    // PAGED, and it must be: PostgREST caps a response at 1000 rows server-side
    // and says nothing about it (see allForOrg in monthlyFinancial.repository.js,
    // which documents this bug after it silently wrecked every QuickBooks-derived
    // figure in the product). Ordered on `id`, the table's own unique key, so
    // OFFSET paging cannot repeat or skip a row; stops on an EMPTY page, never a
    // short one — the server's cap is its own setting, and treating a short page
    // as the last would reintroduce the same truncation at whatever that number
    // happens to be.
    // `customerIds`, when given, narrows the read to those accounts. The
    // reconciliation service passes the accounts the DEEP pull can actually
    // cover, because otherwise the two sides of the comparison span different
    // account sets: ad_metrics keeps 92 days of history for an account that has
    // since been deactivated, deselected, or found to bill in a currency we
    // refuse to convert, while the deep tables hold nothing for it. That
    // account's whole spend would then read as a permanent unexplained red gap
    // on the one screen built to prove the numbers tally. An EMPTY array means
    // "no account is covered" and is honoured as such (a zero campaign total,
    // matching a zero deep total); null/undefined means "no filter".
    // `practiceId` is LAST on purpose: the reconciliation call site passes four
    // positional arguments plus customerIds and must keep working untouched.
    // When given it narrows to one practice exactly as campaignSpend() does —
    // the Facebook report's campaign tier needs it, because its funnel is
    // practice-scoped and dividing group-wide spend by one practice's leads
    // makes every cost figure wrong by the number of practices.
    async campaignSpendByProvider(orgId, since, until, provider, customerIds = null, practiceId = null) {
        const PAGE = 1000;
        const MAX_PAGES = 500;   // a bound against a faulty server, not real data
        if (Array.isArray(customerIds) && customerIds.length === 0) return [];
        const rows = [];
        for (let from = 0, pages = 0; pages < MAX_PAGES; pages++) {
            // Widened beyond spend_pence: the Facebook report's campaign tier
            // (Task 3) reads campaign identity, status and platform metrics
            // off this same paged read. Reconciliation only ever sums
            // spend_pence and is unaffected by the extra columns.
            //
            // metric_date is selected as well as filtered on, because the
            // report collapses campaign x day to campaign and campaign_status
            // is stamped per day (the sync writes the status as it stood when
            // that day's row was written). Picking the status off the LATEST
            // day is the only way to report the status a campaign is in now;
            // `id` cannot do that job — it is a random uuid, so ordering by it
            // says nothing about time.
            let q = supabase_1.serviceClient
                .from('ad_metrics')
                .select('id, customer_id, campaign_id, campaign_name, campaign_status, metric_date, impressions, clicks, spend_pence')
                .eq('organisation_id', orgId)
                .eq('provider', provider)
                .gte('metric_date', since)
                .lte('metric_date', until)
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (Array.isArray(customerIds)) q = q.in('customer_id', customerIds.map(String));
            if (practiceId) q = q.eq('practice_id', practiceId);
            const { data, error } = await q;
            if (error) throw new Error(`ad_metrics read: ${error.message}`);
            const page = Array.isArray(data) ? data : [];
            rows.push(...page);
            if (page.length === 0) break;
            from += page.length;
        }
        return rows;
    },

    // Has ANY metric row for this provider ever landed for this org?
    //
    // A single indexed probe, deliberately UNBOUNDED BY DATE: it exists to
    // tell "this tenant has never synced" apart from "this tenant synced fine
    // but bought nothing in the window you are looking at" — two facts that
    // both render as an empty window and must not share one message. Reading
    // ad_metrics is the only trustworthy signal; ad_accounts.period_synced_at
    // records that a sync RAN, not what came back (migration 000116).
    async hasProviderMetrics(orgId, provider) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_metrics')
            .select('id')
            .eq('organisation_id', orgId)
            .eq('provider', provider)
            .limit(1);
        if (error) throw new Error(`ad_metrics probe: ${error.message}`);
        return (data ?? []).length > 0;
    },

    // One provider's ad accounts with the two fields that decide whether the
    // deep pull can reach an account: platform status and currency. Those are
    // the only two that PARTITION the data — is_selected is deliberately NOT
    // read here, because neither sync consults it, so a deselected account
    // still receives rows in ad_metrics and in the deep tables alike.
    // Deliberately separate from adAccounts() below, which answers a different
    // question (practice mapping) for a different screen — widening that
    // select would couple the two.
    async adAccountsForProvider(orgId, provider) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_accounts')
            .select('customer_id, name, currency, status')
            .eq('organisation_id', orgId)
            .eq('provider', provider);
        if (error) throw new Error(`ad_accounts read: ${error.message}`);
        return data ?? [];
    },

    // The org's ad accounts and which practice each is mapped to. Read so the
    // screen can distinguish "this practice spent nothing" from "no ad account
    // is mapped to this practice, so we cannot attribute any spend to it" —
    // two very different messages that both render as £0.00 without it.
    async adAccounts(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_accounts')
            .select('provider, customer_id, name, practice_id, is_selected')
            .eq('organisation_id', orgId);
        if (error) throw new Error(`ad_accounts read: ${error.message}`);
        return data ?? [];
    },

    // Leads with their attribution and whether they became a Dentally patient.
    //
    // PAGINATED, and it must be. PostgREST's 1000-row cap applies to a
    // set-returning FUNCTION exactly as it does to a table — the result is
    // exposed as a relation — so a plain `.rpc()` silently returned the first
    // 1000 leads and nothing said so. Plan4growth's August 2026 window holds
    // 1,222; the screen showed "Leads 1,000" and, because the truncation cut
    // the converted rows too, 44 patients against a true 122. A round number
    // in a KPI tile is the tell.
    //
    // Ordering is what makes paging sound: OFFSET without ORDER BY may return
    // the same row twice and skip another. The function emits exactly one row
    // per contact (its lead_contacts CTE is DISTINCT on contact columns), so
    // contact_id is a unique, stable sort key.
    async leadsByCampaign(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const rows = [];
        for (let from = 0; ; ) {
            const { data, error } = await supabase_1.serviceClient
                .rpc('ad_lead_conversions', {
                    p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
                })
                .order('contact_id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(`ad_lead_conversions: ${error.message}`);
            const page = data ?? [];
            rows.push(...page);
            // Advance by what the server actually returned and stop only on an
            // EMPTY page, never on a short one. The server's cap is its own
            // setting: if it were below PAGE, treating a short page as the last
            // page would reintroduce the very truncation this fixes, just at a
            // different number. Costs one extra round trip; buys immunity.
            if (page.length === 0) break;
            from += page.length;
        }
        return rows.map((r) => ({
            ad_campaign_id: r.ad_campaign_id ?? null,
            attribution_source: r.attribution_source ?? null,
            contact_id: r.contact_id,
            practice_id: r.practice_id ?? null,
            converted: r.converted === true,
            is_new_patient: r.is_new_patient === true,
            matched_by: r.matched_by ?? null,
            first_lead_at: r.first_lead_at ?? null,
            booked_at: r.booked_at ?? null,
            attended: r.attended === true,
            ghl_pipeline_id: r.ghl_pipeline_id ?? null,
        }));
    },

    // GoHighLevel pipeline id -> name, for the org's connected subaccounts.
    //
    // Names are NOT stored on the lead: a lead carries only ghl_pipeline_id,
    // and the definitions live in each subaccount's synced config. Two
    // subaccounts hold disjoint pipeline sets, so this merges across all of
    // them — a lead can only belong to its own Location's pipeline, so the
    // merged map cannot mis-resolve one.
    //
    // Falls back to the single legacy `integrations` row for orgs connected
    // before the multi-subaccount model, which is the same order of precedence
    // leadService.pipelines uses.
    async pipelineNames(orgId) {
        const byId = new Map();
        const { data: accounts, error } = await supabase_1.serviceClient
            .from('integration_accounts')
            .select('config')
            .eq('organisation_id', orgId)
            .eq('provider', 'gohighlevel');
        if (error) throw new Error(`integration_accounts read: ${error.message}`);
        for (const account of accounts ?? []) {
            for (const p of account?.config?.pipelines ?? []) {
                if (p?.id && p?.name && !byId.has(String(p.id))) byId.set(String(p.id), p.name);
            }
        }
        if (byId.size) return byId;

        const { data: legacy } = await supabase_1.serviceClient
            .from('integrations')
            .select('config')
            .eq('organisation_id', orgId)
            .eq('provider', 'gohighlevel')
            .maybeSingle();
        for (const p of legacy?.config?.pipelines ?? []) {
            if (p?.id && p?.name && !byId.has(String(p.id))) byId.set(String(p.id), p.name);
        }
        return byId;
    },

    // Campaign-grain counts: leads, booked, attended, patients, new patients.
    //
    // A dedicated aggregate rather than counting leadsByCampaign in JS. That
    // function returns one row per PERSON — 10,429 over a year at 2.8s a call,
    // which PostgREST's 1000-row cap turns into eleven calls just to produce
    // counts. This returns campaigns x sources x practices, a few hundred rows.
    //
    // Grouped rather than collapsed to campaign so ONE call still feeds the
    // campaign table, the channel split and the practice comparison. Exact, not
    // approximate: ad_lead_conversions emits one row per person, so each person
    // lands in exactly one group.
    //
    // Paged on principle. The row count should sit well under the cap, but the
    // cap has silently truncated this file twice and four lines buy immunity.
    async campaignFunnel(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const rows = [];
        for (let from = 0; ; ) {
            const { data, error } = await supabase_1.serviceClient
                .rpc('ad_campaign_funnel', {
                    p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
                })
                // OFFSET without ORDER BY may repeat one row and skip another.
                // The RPC groups by (ad_campaign_id, attribution_source,
                // practice_id) together — that triple is the GROUP BY key and
                // so is unique per row, but NONE of the three columns is
                // unique alone (e.g. every unattributed group shares
                // ad_campaign_id = NULL, split across practices and sources).
                // Sort by all three, or a page boundary landing inside a tie
                // can duplicate one row and drop another.
                .order('ad_campaign_id', { ascending: true, nullsFirst: true })
                .order('attribution_source', { ascending: true, nullsFirst: true })
                .order('practice_id', { ascending: true, nullsFirst: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(`ad_campaign_funnel: ${error.message}`);
            const page = data ?? [];
            rows.push(...page);
            // Stop on an EMPTY page, never a short one — see leadsByCampaign.
            if (page.length === 0) break;
            from += page.length;
        }
        return rows.map((r) => ({
            ad_campaign_id: r.ad_campaign_id ?? null,
            attribution_source: r.attribution_source ?? null,
            practice_id: r.practice_id ?? null,
            leads: Number(r.leads ?? 0),
            booked: Number(r.booked ?? 0),
            attended: Number(r.attended ?? 0),
            patients: Number(r.patients ?? 0),
            newPatients: Number(r.new_patients ?? 0),
        }));
    },

    // The Facebook report's funnel, at (campaign, ad set, ad) grain.
    //
    // PAGED, and it must be: PostgREST caps a response at 1000 rows
    // server-side and reports nothing, and that cap applies to set-returning
    // RPCs exactly as it does to tables. Calling an RPC is not an escape from
    // it.
    //
    // ad_meta_funnel's GROUP BY is the four-column tuple
    // (campaign_id, ad_set_id, ad_id, practice_id) — NONE of the four is
    // unique alone, same hazard as campaignFunnel above. `ad_id` repeats: it
    // is NULL for every "not identified" row (a lead whose ad set could not
    // be resolved), and a single non-null ad_id repeats across several rows
    // when the same Facebook ad runs group-wide across multiple practices
    // (practice_id comes from the lead's own routing, not from ad
    // targeting — entirely normal for a multi-practice dental chain). Sort by
    // all four, in the RPC's own GROUP BY order, or a page boundary landing
    // inside a tie can duplicate one row and drop another.
    //
    // `until` is EXCLUSIVE here, unlike campaignSpendByProvider's inclusive
    // `until` — ad_lead_conversions bounds leads with `created_at < $3`
    // because a lead carries a time, not a date. Callers converting between
    // the two conventions must do it at the call site (see funnelUntil in
    // facebook-report.service.js); passing an inclusive date straight through
    // loses the whole last day's leads.
    async metaFunnel(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const MAX_PAGES = 500;   // a bound against a faulty server, not real data
        const rows = [];
        for (let from = 0, pages = 0; pages < MAX_PAGES; pages++) {
            const { data, error } = await supabase_1.serviceClient
                .rpc('ad_meta_funnel', {
                    p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
                })
                .order('campaign_id', { ascending: true, nullsFirst: true })
                .order('ad_set_id', { ascending: true, nullsFirst: true })
                .order('ad_id', { ascending: true, nullsFirst: true })
                .order('practice_id', { ascending: true, nullsFirst: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(`ad_meta_funnel: ${error.message}`);
            const page = data ?? [];
            rows.push(...page);
            // Stop on an EMPTY page, never a short one. The server's cap is its
            // own setting; treating a short page as the last reintroduces the
            // truncation at whatever that cap happens to be.
            if (page.length === 0) break;
            from += page.length;
        }
        return rows.map((r) => ({
            campaign_id: r.campaign_id ?? null,
            ad_set_id: r.ad_set_id ?? null,
            ad_id: r.ad_id ?? null,
            practice_id: r.practice_id ?? null,
            // PostgREST commonly serialises bigint as a JSON string to avoid
            // precision loss — coerce, matching campaignFunnel/leadsByCampaign
            // in this same file.
            leads: Number(r.leads ?? 0),
            booked: Number(r.booked ?? 0),
            attended: Number(r.attended ?? 0),
            patients: Number(r.patients ?? 0),
            new_patients: Number(r.new_patients ?? 0),
        }));
    },

    // Spend, leads and patients per month per channel.
    //
    // A dedicated aggregate, NOT leadsByCampaign over a wide window: a year is
    // 10,429 lead rows at 2.8s a call, and PostgREST's 1000-row cap forces
    // eleven of them. This returns months x 3 channels — 36 rows, 238ms warm.
    async monthlyRollup(orgId, since, until, practiceId = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('marketing_monthly_rollup', {
            p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
        });
        if (error) throw new Error(`marketing_monthly_rollup: ${error.message}`);
        return (data ?? []).map((r) => ({
            month: r.month,
            channel: r.channel,
            leads: Number(r.leads ?? 0),
            patients: Number(r.patients ?? 0),
            newPatients: Number(r.new_patients ?? 0),
            spendPence: Number(r.spend_pence ?? 0),
        }));
    },

    // Display fields for ONE PAGE of leads. Only the ids actually being shown
    // are fetched — the window can hold thousands of people, and none of the
    // rest need their name read out of the database to render a table of 50.
    async contactsByIds(orgId, ids) {
        if (!ids?.length) return [];
        const { data, error } = await supabase_1.serviceClient
            .from('contacts')
            .select('id, first_name, last_name, email, phone, source')
            .eq('organisation_id', orgId)
            .in('id', ids);
        if (error) throw new Error(`contacts read: ${error.message}`);
        return data ?? [];
    },
};
