// GoHighLevel inbound sync — pulls Opportunities (+ their Contacts) from GHL
// and reconciles them into Elevate's leads/contacts. Inbound only for v1;
// push-back and the real-time webhook are deferred (see highleveltodo.md).
//
// Invoked hourly by workers/index.js (syncAllOrgs). Per active org:
//   1. ensureFreshToken — refresh if expired (provider guards the single-use token)
//   2. fetch opportunities (GHL V2, 429-aware)
//   3. for each: match-or-create contact → upsert lead (stage-mapped, value→pence)
//
// Rate limit (Edge Case 4): GHL allows ~100 req / 10s. We fetch sequentially
// and on a 429 honor retry-after (+500ms) then retry. No queue infra.
//
//   DATA FLOW
//   GHL /opportunities/search ──┐
//                               ▼
//   opp ──► matchContact (ghl_contact_id → email → phone → create) ──► contact_id
//                               ▼
//   upsert leads (ghl_opportunity_id unique per org, sync_status='synced',
//                 status = mapStage(...), estimated_value_pence = toPence(...))

import { integrationRepository } from '../../repositories/integration.repository.js';
import { decryptSecret } from '../crypto.js';
import { GoHighLevelProvider } from './gohighlevel-provider.js';
import * as supabase_1 from '../supabase.js';

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

export const ELEVATE_STATUSES = [
    'new', 'contact_attempted', 'contact_made', 'consultation_booked',
    'consultation_attended', 'treatment_started', 'treatment_completed',
    'not_proceeding', 'failed_to_attend',
];

// --- pure helpers (unit-tested) ------------------------------------------

// Convert a GHL monetary value (major currency units, possibly float/string)
// to integer pence. Never floats downstream (project rule 2).
export function toPence(value) {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (n == null || Number.isNaN(n)) return 0;
    return Math.round(n * 100);
}

// Normalise a phone number for fuzzy matching: digits only, strip a UK/intl
// trunk so "+44 7700 900123", "07700900123" and "447700900123" all converge.
export function normalizePhone(raw) {
    if (!raw) return null;
    let d = String(raw).replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('44')) d = d.slice(2);       // +44...
    else if (d.startsWith('0')) d = d.replace(/^0+/, ''); // national 0-prefix
    return d || null;
}

// Map a GHL pipeline stage to an Elevate status.
// Precedence: explicit user mapping (config.stage_mappings) > name heuristic > 'new'.
export function mapStage(ghlStageId, ghlStageName, stageMappings = {}) {
    const mapped = stageMappings?.[ghlStageId];
    if (mapped && ELEVATE_STATUSES.includes(mapped)) return mapped;

    const name = (ghlStageName ?? '').toLowerCase();
    if (/(won|treatment\s*start|started|sold)/.test(name)) return 'treatment_started';
    if (/(complete|finished)/.test(name)) return 'treatment_completed';
    if (/(attended|consult.*done|showed)/.test(name)) return 'consultation_attended';
    if (/(book|scheduled|appointment)/.test(name)) return 'consultation_booked';
    if (/(contact.*made|connected|spoke|reached)/.test(name)) return 'contact_made';
    if (/(attempt|contacting|no\s*answer|follow)/.test(name)) return 'contact_attempted';
    if (/(lost|dead|not\s*proceed|unqualified|abandoned)/.test(name)) return 'not_proceeding';
    if (/(no\s*show|missed)/.test(name)) return 'failed_to_attend';
    return 'new';
}

// Extract the contact sub-object from a GHL opportunity, tolerating shape drift.
export function extractContact(opp) {
    const c = opp.contact ?? {};
    const name = c.name ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    const [first, ...rest] = (name || 'Unknown').split(' ');
    return {
        ghl_contact_id: c.id ?? opp.contactId ?? null,
        first_name: c.firstName ?? first ?? 'Unknown',
        last_name: c.lastName ?? (rest.join(' ') || null),
        email: c.email ? String(c.email).toLowerCase() : null,
        phone: c.phone ?? null,
    };
}

// --- DB-bound sync -------------------------------------------------------

// GHL fetch with one 429 retry honoring retry-after (+500ms buffer).
async function ghlFetch(path, accessToken, locationId) {
    const url = new URL(`${API_BASE}${path}`);
    if (locationId) url.searchParams.set('location_id', locationId);
    url.searchParams.set('limit', '100');
    const doFetch = () => fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}`, Version: API_VERSION, Accept: 'application/json' },
    });
    let res = await doFetch();
    if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '2', 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000 + 500));
        res = await doFetch();
    }
    if (!res.ok) throw new Error(`GHL ${path} → ${res.status}`);
    return res.json();
}

// Match an existing contact, else create one. Priority: ghl_contact_id →
// email (case-insensitive) → normalised phone. Returns the contact id.
export async function matchOrCreateContact(orgId, c, db = supabase_1.serviceClient) {
    if (c.ghl_contact_id) {
        const { data } = await db.from('contacts').select('id')
            .eq('organisation_id', orgId).eq('ghl_contact_id', c.ghl_contact_id).maybeSingle();
        if (data) return data.id;
    }
    if (c.email) {
        const { data } = await db.from('contacts').select('id')
            .eq('organisation_id', orgId).ilike('email', c.email).maybeSingle();
        if (data) {
            if (c.ghl_contact_id) {
                await db.from('contacts').update({ ghl_contact_id: c.ghl_contact_id }).eq('id', data.id);
            }
            return data.id;
        }
    }
    if (c.phone) {
        const norm = normalizePhone(c.phone);
        if (norm) {
            // ilike on the suffix catches differing trunk/format without a normalised column.
            const { data } = await db.from('contacts').select('id, phone')
                .eq('organisation_id', orgId).ilike('phone', `%${norm}%`).limit(1);
            if (data?.length) return data[0].id;
        }
    }
    const { data: created, error } = await db.from('contacts').insert({
        organisation_id: orgId,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        ghl_contact_id: c.ghl_contact_id,
        source: 'gohighlevel',
    }).select('id').single();
    if (error) throw new Error(`contact insert failed: ${error.message}`);
    return created.id;
}

// Ensure the access token is fresh; refresh (provider-guarded) if expired/near.
async function ensureFreshToken(orgId, integration) {
    const exp = integration.expires_at ? Date.parse(integration.expires_at) : 0;
    if (exp && exp - Date.now() > 60_000) return integration; // > 60s left
    await GoHighLevelProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'gohighlevel');
}

export async function syncOneOrg(orgId, integrationRow) {
    let integration = integrationRow ?? await integrationRepository.getByProvider(orgId, 'gohighlevel');
    if (!integration || integration.status !== 'active' || !integration.secrets) {
        return { synced: 0, skipped: 'inactive' };
    }
    integration = await ensureFreshToken(orgId, integration);
    if (!integration?.secrets) return { synced: 0, skipped: 'no_token' };

    const { access_token } = JSON.parse(decryptSecret(integration.secrets));
    const locationId = integration.config?.locationId;
    if (!access_token || !locationId) return { synced: 0, skipped: 'no_location' };

    const stageMappings = integration.config?.stage_mappings ?? {};
    const payload = await ghlFetch('/opportunities/search', access_token, locationId);
    const opportunities = payload.opportunities ?? [];

    let synced = 0;
    for (const opp of opportunities) {
        const contact = extractContact(opp);
        const contactId = await matchOrCreateContact(orgId, contact);
        const status = mapStage(opp.pipelineStageId, opp.stageName ?? opp.pipelineStageName, stageMappings);
        const { error } = await supabase_1.serviceClient.from('leads').upsert({
            organisation_id: orgId,
            contact_id: contactId,
            ghl_opportunity_id: opp.id,
            ghl_pipeline_id: opp.pipelineId ?? null,
            treatment: opp.name ?? 'Enquiry',
            estimated_value_pence: toPence(opp.monetaryValue),
            status,
            sync_status: 'synced',
            source: 'gohighlevel',
        }, { onConflict: 'organisation_id,ghl_opportunity_id' });
        if (!error) synced++;
    }

    await integrationRepository.setSyncTime(orgId, 'gohighlevel');
    return { synced, total: opportunities.length };
}

export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'gohighlevel')
        .eq('status', 'active');
    const results = [];
    for (const row of rows ?? []) {
        try {
            const r = await syncOneOrg(row.organisation_id, row);
            results.push({ orgId: row.organisation_id, ...r });
        } catch (err) {
            results.push({ orgId: row.organisation_id, error: err.message });
        }
    }
    return results;
}
