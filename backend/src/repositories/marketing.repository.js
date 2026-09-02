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
