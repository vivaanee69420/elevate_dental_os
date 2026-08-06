// Matcher: Dentally patient contact -> GHL contact with a pipeline lead.
// Exact equality after normalisation; auditable tiebreaks; never mutates
// contacts/leads/queue — its ONLY write is warming a subaccount's cached
// pipeline definitions (mergeConfig) when a live refresh finds new ones.
// Tenant isolation: every read is org-scoped in the repository.
import { sheetExportRepository } from '../repositories/sheet-export.repository.js';
import { integrationAccountRepository } from '../repositories/integration-account.repository.js';
import { integrationRepository } from '../repositories/integration.repository.js';
import { normaliseEmail, normalisePhone } from '../lib/sheet-export/normalise.js';

export async function pipelineNameMap(orgId) {
    const byId = new Map();
    const accounts = await integrationAccountRepository.list(orgId, 'gohighlevel').catch(() => []);
    for (const account of accounts ?? []) {
        for (const p of account.config?.pipelines ?? []) {
            if (p?.id && !byId.has(p.id)) byId.set(String(p.id), p.name ?? String(p.id));
        }
    }
    if (byId.size === 0) {
        const legacy = await integrationRepository.getByProvider(orgId, 'gohighlevel').catch(() => null);
        for (const p of legacy?.config?.pipelines ?? []) {
            if (p?.id) byId.set(String(p.id), p.name ?? String(p.id));
        }
    }
    return byId;
}

async function pickCandidate(orgId, candidates) {
    if (candidates.length === 0) return null;
    const leads = await sheetExportRepository.pipelineLeads(orgId, candidates.map((c) => c.id));
    const byContact = new Map();
    for (const lead of leads) {
        if (!byContact.has(lead.contact_id)) byContact.set(lead.contact_id, []);
        byContact.get(lead.contact_id).push(lead);
    }
    // Tiebreak: prefer a candidate that actually holds a pipeline lead; if
    // several (or none) do, most recently created contact. Recorded upstream in
    // matched_contact_id so the choice is auditable, never silent.
    const withLeads = candidates.filter((c) => byContact.has(c.id));
    const pool = withLeads.length > 0 ? withLeads : candidates;
    pool.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const chosen = pool[0];
    const chosenLeads = byContact.get(chosen.id) ?? [];
    if (chosenLeads.length === 0) return null; // matched a person, but no pipeline lead
    chosenLeads.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { contact: chosen, leads: chosenLeads }; // ascending — earliest first
}

// Live-refresh one subaccount's pipeline definitions from GHL and warm the
// cached config. Best-effort: any failure (revoked token, GHL down) returns an
// empty map and the caller falls back to 'Unknown pipeline'.
async function refreshAccountPipelines(orgId, accountId) {
    const out = new Map();
    try {
        const acc = await integrationAccountRepository.getByIdWithSecrets(orgId, accountId);
        if (!acc?.secrets) return out;
        const { decryptSecret } = await import('../lib/crypto.js');
        const { detectPipelinesForToken } = await import('../lib/integrations/gohighlevel-sync.js');
        const { access_token } = JSON.parse(decryptSecret(acc.secrets));
        const { pipelines = [] } = await detectPipelinesForToken(access_token, acc.external_account_id);
        if (pipelines.length) {
            await integrationAccountRepository.mergeConfig(orgId, accountId, { pipelines });
        }
        for (const p of pipelines) if (p?.id) out.set(String(p.id), p.name ?? String(p.id));
    } catch { /* best-effort cache warm only */ }
    return out;
}

// opts.leadsAfter: re-enquiry episodes scope the journey/incoming-date to
// leads created at/after the episode's triggering lead (queue.episode_lead_at)
// — the second conversion's row reports the NEW enquiry, not the original one.
export async function findMatch(orgId, dentallyContact, opts = {}) {
    const email = normaliseEmail(dentallyContact?.email);
    const phone = normalisePhone(dentallyContact?.phone);
    if (!email && !phone) return null;

    let picked = null;
    if (email) {
        const candidates = (await sheetExportRepository.ghlCandidatesByEmail(orgId, email))
            .filter((c) => c.id !== dentallyContact.id && normaliseEmail(c.email) === email);
        picked = await pickCandidate(orgId, candidates);
    }
    if (!picked && phone) {
        const candidates = (await sheetExportRepository.ghlCandidatesByPhone(orgId, phone.suffix9))
            .filter((c) => c.id !== dentallyContact.id
                && normalisePhone(c.phone)?.canonical === phone.canonical);
        picked = await pickCandidate(orgId, candidates);
    }
    if (!picked) return null;
    if (opts.leadsAfter) {
        picked.leads = picked.leads.filter((l) => new Date(l.created_at) >= new Date(opts.leadsAfter));
        if (picked.leads.length === 0) return null; // no lead in this episode's window
    }

    // Source column = the FULL enquiry journey: every pipeline the contact's
    // leads sit in, oldest -> newest (a person often enquires more than once —
    // e.g. Facebook first, Google later — and hiding either would mis-credit
    // a channel). Names resolve from the cached pipeline definitions; leads in
    // deleted/archived pipelines have no name anywhere and are omitted from
    // the journey. If NOTHING resolves, the cache may just be stale —
    // live-refresh the owning subaccount's pipelines once, then retry; only
    // after that fall back to 'Unknown pipeline' (never a raw GHL id).
    // Lead Incoming Date = the FIRST enquiry, regardless of resolvability.
    const names = await pipelineNameMap(orgId);
    const resolves = (l) => names.has(String(l.ghl_pipeline_id));
    if (!picked.leads.some(resolves)) {
        const accountId = picked.leads.find((l) => l.integration_account_id)?.integration_account_id;
        if (accountId) {
            const refreshed = await refreshAccountPipelines(orgId, accountId);
            for (const [k, v] of refreshed) if (!names.has(k)) names.set(k, v);
        }
    }
    const seen = new Set();
    const journey = [];
    for (const l of picked.leads) {
        const n = names.get(String(l.ghl_pipeline_id));
        if (n && !seen.has(n)) { seen.add(n); journey.push(n); }
    }
    const lead = picked.leads[0]; // earliest enquiry = the incoming date
    return {
        matchedContact: picked.contact,
        lead,
        pipelineName: journey.length ? journey.join(' → ') : 'Unknown pipeline',
        leadCreatedAt: lead.created_at,
    };
}
