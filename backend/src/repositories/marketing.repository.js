// Marketing data access — queries in, rows out. No logic here.
// serviceClient has NO automatic isolation: every query filters
// organisation_id explicitly (rule 3).
import * as supabase_1 from '../lib/supabase.js';

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
                .select('provider, customer_id, campaign_id, campaign_name, spend_pence, impressions, clicks, conversions')
                .eq('organisation_id', orgId)
                // metric_date is a DATE while the scope window is an ISO
                // datetime with an EXCLUSIVE until — slice to the date part and
                // keep the half-open comparison, or the last day double-counts.
                .gte('metric_date', String(since).slice(0, 10))
                .lt('metric_date', String(until).slice(0, 10))
                .range(from, from + PAGE - 1);
            if (practiceId) q = q.eq('practice_id', practiceId);
            const { data, error } = await q;
            if (error) throw new Error(`ad_metrics read: ${error.message}`);
            const rows = data ?? [];
            out.push(...rows);
            if (rows.length < PAGE) break;
        }
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
        return [...byCampaign.values()];
    },

    // Leads with their attribution and whether they became a Dentally patient.
    async leadsByCampaign(orgId, since, until, practiceId = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('ad_lead_conversions', {
            p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
        });
        if (error) throw new Error(`ad_lead_conversions: ${error.message}`);
        return (data ?? []).map((r) => ({
            ad_campaign_id: r.ad_campaign_id ?? null,
            attribution_source: r.attribution_source ?? null,
            contact_id: r.contact_id,
            converted: r.converted === true,
        }));
    },
};
