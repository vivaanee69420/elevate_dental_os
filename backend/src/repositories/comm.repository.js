// ============================================================================
// Comm repository — Supabase data access for the communications domain.
// Phase 6: visibility filtering. Rows have a `visibility` column:
//   'org' | 'role:owner' | 'role:practice_manager' | 'role:reception' |
//   'user:<uuid>'
// list() now accepts the caller's role + id to filter rows the caller is
// allowed to see. Owners always see everything in their org.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const commRepository = {
    async list(orgId, q, viewer = null) {
        let query = supabase_1.serviceClient
            .from('communications')
            .select('*, contact:contacts(id, first_name, last_name, email, integration_account_id), lead:leads(id, integration_account_id)')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(200);
        if (q.contact_id) query = query.eq('contact_id', q.contact_id);
        if (q.lead_id)    query = query.eq('lead_id', q.lead_id);
        if (q.channel)    query = query.eq('channel', q.channel);
        if (q.integration_account_id) query = query.eq('integration_account_id', q.integration_account_id);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        // Visibility filter — happens app-side. Owner sees all.
        if (!viewer || viewer.role === 'owner') return data;
        const allowedVisibility = new Set(['org', `role:${viewer.role}`, `user:${viewer.id}`]);
        return (data ?? []).filter((row) => {
            const v = row.visibility ?? 'org';
            return allowedVisibility.has(v) || row.assigned_user_id === viewer.id;
        });
    },
    // ------------------------------------------------------------------
    // Inbox, aggregated in SQL.
    //
    // `list()` above caps at 200 rows and threads them in the browser. On live
    // data that showed 105 of 12,764 conversations (0.8%) and an unread badge
    // reading 10 against a true 5,753 — and because the search box filtered
    // that same page, searching a real patient returned nothing 99% of the
    // time. These two read the whole population and page properly.
    //
    // The viewer is passed through to SQL so the per-row `visibility` model
    // `list()` enforces is not lost on the way: an aggregate that ignored it
    // would widen what a non-owner can see.
    // ------------------------------------------------------------------
    async inboxThreads(orgId, viewer, q = {}) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('crm_inbox_threads', {
                p_org: orgId,
                p_viewer_role: viewer?.role ?? 'reception',
                p_viewer_id: viewer?.id ?? null,
                p_account: q.integration_account_id ?? null,
                p_search: q.search ?? null,
                p_channel: q.channel ?? null,
                p_unread_only: q.unread_only ?? false,
                p_limit: q.limit ?? 50,
                p_offset: q.offset ?? 0,
            });
        if (error) throw new Error(error.message);
        return data ?? [];
    },
    async inboxSummary(orgId, viewer, accountId = null) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('crm_inbox_summary', {
                p_org: orgId,
                p_viewer_role: viewer?.role ?? 'reception',
                p_viewer_id: viewer?.id ?? null,
                p_account: accountId,
            });
        if (error) throw new Error(error.message);
        return data?.[0] ?? null;
    },
    // Every message in ONE thread, for the reading pane. Bounded and org-scoped.
    // Threads are conversations, not archives — 200 messages is generous for
    // one, where it was never enough for a whole inbox.
    async threadMessages(orgId, { contactId = null, leadId = null, channel = null, counterparty = null }, limit = 200) {
        let query = supabase_1.serviceClient
            .from('communications')
            .select('*')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: true })
            .limit(limit);
        if (contactId) query = query.eq('contact_id', contactId);
        else if (leadId) query = query.eq('lead_id', leadId);
        else {
            // Address-keyed thread: no contact or lead to key on, so match the
            // channel plus whichever address column holds the counterparty.
            if (channel) query = query.eq('channel', channel);
            if (counterparty) {
                query = query.or(`from_address.eq.${counterparty},to_address.eq.${counterparty}`);
            }
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },
    async create(row) {
        return supabase_1.serviceClient.from('communications').insert(row).select().single();
    },
};
