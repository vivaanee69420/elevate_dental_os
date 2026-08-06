// Pure-read matcher: Dentally patient contact -> GHL contact with a pipeline
// lead. Exact equality after normalisation; auditable tiebreaks; never mutates
// contacts/leads. Tenant isolation: every read is org-scoped in the repository.
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
    return { contact: chosen, lead: chosenLeads[0] }; // EARLIEST lead = true incoming date
}

export async function findMatch(orgId, dentallyContact) {
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

    const names = await pipelineNameMap(orgId);
    const pid = String(picked.lead.ghl_pipeline_id);
    return {
        matchedContact: picked.contact,
        lead: picked.lead,
        pipelineName: names.get(pid) ?? pid,
        leadCreatedAt: picked.lead.created_at,
    };
}
