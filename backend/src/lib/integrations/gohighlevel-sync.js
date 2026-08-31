// GoHighLevel inbound sync — pulls Contacts + Opportunities from GHL and
// reconciles them into Elevate's contacts/leads. Brought up to Dentally parity:
// paginated full-history pull on connect (bootstrapOnConnect), per-phase progress
// reporting, real-time webhook ingestion (applyWebhookEvent), and pipeline-stage
// detection for the mapping UI.
//
// Invoked hourly by workers/index.js (syncAllOrgs), on connect (bootstrapOnConnect),
// and on demand (Refresh / Pull Full History via integration.service.syncNow). Per org:
//   1. ensureFreshToken — refresh if expired (provider guards the single-use token)
//   2. (full/recent only) pull all Contacts, paginated → upsert contacts
//   3. pull Opportunities, paginated → match-or-create contact → upsert lead
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
//
// Idempotent: leads upsert on (organisation_id, ghl_opportunity_id) and contacts
// on (organisation_id, ghl_contact_id) — re-pulling / a redelivered webhook
// updates in place, never duplicates. The same upsertOpportunity/contactRow path
// is shared by the poll AND the webhook so both stay consistent (mirrors the
// Dentally row-builder precedent).

import { integrationRepository } from '../../repositories/integration.repository.js';
import { integrationAccountRepository } from '../../repositories/integration-account.repository.js';
import { ghlAppointmentRepository } from '../../repositories/ghl-appointment.repository.js';
import { decryptSecret } from '../crypto.js';
import { GoHighLevelProvider } from './gohighlevel-provider.js';
import { syncConversations } from './gohighlevel-conversations.js';
import { extractAttribution } from './ghl-attribution.js';
import * as supabase_1 from '../supabase.js';
// Capture is a no-op when Sentry was never init'd (no SENTRY_DSN, e.g. local
// and tests), so this is safe to import unconditionally.
import * as Sentry from '@sentry/node';

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const PER_PAGE = 100;
const MAX_PAGES = 50;            // routine/incremental cap (~5k rows/resource) — bounded so a foreground Refresh stays fast
const BOOTSTRAP_MAX_PAGES = 500; // full-history / on-connect pull cap (~50k rows/resource)
const UPSERT_CHUNK = 500;
const OPP_CONCURRENCY = 10;       // parallel opportunity upserts (bounded so we stay under GHL/DB limits)

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
    // Won / completed treatment — includes "closed" as a common GHL won stage
    if (/(won|treatment\s*start|started|sold|^closed$|closed\s*won)/.test(name)) return 'treatment_started';
    if (/(complete|finished|treatment\s*complet)/.test(name)) return 'treatment_completed';
    // Attended consultation
    if (/(attended|consult.*done|showed)/.test(name)) return 'consultation_attended';
    // Booked consultation / appointment
    if (/(book|scheduled|appointment|call\s*book)/.test(name)) return 'consultation_booked';
    // Contact made / connected
    if (/(contact.*made|connected|spoke|reached|contacted)/.test(name)) return 'contact_made';
    // Contact attempted / follow-up
    if (/(attempt|contacting|no\s*answer|follow|prospect\s*add|registered|quiz|new\s*enquiry|new\s*lead)/.test(name)) return 'contact_attempted';
    // Did not attend. MUST be tested before the lost/not-proceeding branch:
    // that branch used to match "no.show" too and ran first, which made this
    // one dead code and silently classified every no-show as not_proceeding.
    // Hyphen/underscore variants ("no-show") aren't \s, hence the class.
    if (/(no[\s\-_]*show|missed|failed.*attend|did\s*not\s*attend|\bdna\b)/.test(name)) return 'failed_to_attend';
    // Lost / not proceeding — includes "junk", "not now" etc.
    if (/(lost|dead|not\s*proceed|unqualified|abandoned|junk|not\s*now|failed|not\s*interest|disqualif)/.test(name)) return 'not_proceeding';
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

// One GHL contact record (from the /contacts pull or a Contact webhook) -> a
// contacts row. Pure (no I/O) so the pull and the webhook map IDENTICALLY,
// mirroring the Dentally row-builder precedent.
export function contactRow(orgId, c, practiceId, integrationAccountId = null) {
    const name = c.name ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    const [first, ...rest] = (name || 'Unknown').split(' ');
    const rawCreated = c.dateAdded ?? c.createdAt ?? null;
    let createdIso = null;
    if (rawCreated != null) {
        const d = new Date(rawCreated);
        if (!Number.isNaN(d.getTime())) createdIso = d.toISOString();
    }
    // Attribution keys are SPREAD ONLY WHEN PRESENT. contacts is written with
    // upsert, so emitting explicit nulls would wipe attribution captured on an
    // earlier run every time GHL sends the contact back without it.
    const attribution = extractAttribution(c);
    return {
        organisation_id: orgId,
        practice_id: practiceId,
        integration_account_id: integrationAccountId,
        source: 'gohighlevel',
        ghl_contact_id: c.id ?? null,
        first_name: c.firstName ?? first ?? 'Unknown',
        last_name: c.lastName ?? (rest.join(' ') || null),
        email: c.email ? String(c.email).toLowerCase() : null,
        phone: c.phone ?? null,
        ...(createdIso ? { created_at: createdIso } : {}),
        ...(attribution ? { ...attribution, attribution_captured_at: new Date().toISOString() } : {}),
    };
}

// Bucket a GHL webhook `type` (e.g. 'OpportunityCreate', 'ContactUpdate',
// 'OpportunityDelete') to the action our receiver handles. Opportunity delete is
// distinguished so the lead can be removed; contact delete is intentionally
// ignored (a contact may own appointments/payments — never cascade-delete it
// from a CRM event). Returns null for unrecognised events (ignored).
export function mapWebhookEventType(raw) {
    const t = String(raw || '').toLowerCase().replace(/[\s_-]/g, '');
    if (t.includes('opportunity')) return t.includes('delete') ? 'opportunity_delete' : 'opportunity';
    if (t.includes('contact')) return t.includes('delete') ? 'contact_delete' : 'contact';
    return null;
}

// Normalise a GHL appointmentStatus string to our internal vocab.
// Input is lowercased + trimmed before matching so casing variants are handled.
export function mapAppointmentStatus(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'showed') return 'showed';
    if (s === 'noshow' || s === 'no-show' || s === 'no_show') return 'noshow';
    if (s === 'cancelled' || s === 'canceled') return 'cancelled';
    if (s === 'confirmed') return 'confirmed';
    if (s === 'new' || s === 'booked') return 'booked';
    if (s === 'invalid') return 'invalid';
    return 'booked'; // default for anything unrecognised / null / empty
}

// Parse a GHL time value (ISO string OR epoch-ms numeric string OR number) to
// an ISO string. Returns null if the value is absent or produces an invalid Date.
function parseGhlTime(x) {
    if (x == null || x === '') return null;
    // Numeric-string epoch ms (e.g. "1750000000000")
    const d = /^\d+$/.test(String(x)) ? new Date(Number(x)) : new Date(x);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Shape one GHL calendar event into a ghl_appointments DB row. Pure (no I/O).
export function appointmentRow(orgId, account, event, calendarName, contactMap) {
    return {
        organisation_id: orgId,
        integration_account_id: account.id,
        practice_id: account.practice_id ?? null,
        contact_id: (event.contactId && contactMap?.get(String(event.contactId))) ?? null,
        ghl_event_id: String(event.id),
        ghl_calendar_id: event.calendarId != null ? String(event.calendarId) : null,
        calendar_name: calendarName ?? null,
        title: event.title ?? null,
        status: mapAppointmentStatus(event.appointmentStatus),
        starts_at: parseGhlTime(event.startTime),
        ends_at: parseGhlTime(event.endTime),
    };
}

// Overall progress %, two-phase (contacts then opportunities) on the bootstrap /
// full pull, single-phase on a routine pull. Each phase owns an equal 1/nPhases
// band; within a phase the bar advances by page/totalPages, or — when GHL omits a
// usable total — by a soft asymptote so it always moves and never freezes at 0.
// Held at 99 until the caller marks the sync done (never a premature 100).
export function phasePct(idx, nPhases, page, totalPages) {
    const base = idx / nPhases;
    const span = 1 / nPhases;
    const within = totalPages && totalPages > 0
        ? Math.min(page / totalPages, 1)
        : 1 - 1 / (page + 1);
    return Math.min(99, Math.round((base + span * within) * 100));
}

// --- DB-bound sync -------------------------------------------------------

// Statuses worth retrying. 429 is GHL's documented rate-limit signal, but the
// July 2026 incident (5 of 7 subaccounts stuck on "failed") was an intermittent
// 400 from GET /contacts/ — every stored failing URL replayed 200 afterwards
// with the same token and location, so those 400s were an upstream blip, not a
// malformed request. A single one used to abort a whole subaccount sync.
// Deliberately EXCLUDES 401/403/404: a revoked token or deleted location is
// deterministic, and retrying it just burns four more requests.
const RETRYABLE_STATUS = new Set([400, 408, 425, 429, 500, 502, 503, 504]);

// GHL GET by absolute URL with bounded retries (retry-after, else exponential
// backoff). Contacts + opportunities now paginate CONCURRENTLY, so the request
// rate roughly doubles and GHL's burst limit (~100 req / 10s) returns 429 in
// waves; a single retry isn't enough (the retry hits the still-open window and
// the page is dropped, failing the whole pull). Up to 4 attempts lets a page
// ride out a sustained burst or a transient upstream fault. Network-level
// faults (ECONNRESET/timeouts) are retried too — they previously threw straight
// out of the loop with no retry at all.
async function ghlFetchUrl(url, accessToken, retries = 4) {
    const baseMs = Number(process.env.GHL_RETRY_BASE_MS ?? 1000);
    const doFetch = () => fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Version: API_VERSION, Accept: 'application/json' },
    });
    const backoff = (attempt, retryAfterSec) => (retryAfterSec > 0 ? retryAfterSec * 1000 : baseMs * 2 ** attempt) + baseMs / 2;
    let res = null;
    let netErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        netErr = null;
        try {
            res = await doFetch();
        } catch (err) {
            netErr = err;
            res = null;
            if (attempt === retries) break;
            await new Promise((r) => setTimeout(r, backoff(attempt, 0)));
            continue;
        }
        if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === retries) break;
        const ra = parseInt(res.headers.get('retry-after') ?? '0', 10);
        await new Promise((r) => setTimeout(r, backoff(attempt, ra)));
    }
    if (netErr) throw new Error(`GHL ${url} → ${netErr.message}`);
    if (!res.ok) {
        // Carry GHL's own error body. Without it every failure persisted as a
        // bare "→ 400", leaving nothing to diagnose from days later.
        const body = await res.text().catch(() => '');
        throw new Error(`GHL ${url} → ${res.status}${body ? ` ${body.slice(0, 300)}` : ''}`);
    }
    return res.json();
}

// A phase's OWN progress (0-100), independent of the other phases — drives the
// separate per-phase percentages in the overlay. Uses page/totalPages when GHL
// reports a total, else a soft asymptote so the bar always advances.
function withinPct(page, totalPages) {
    return totalPages && totalPages > 0
        ? Math.min(100, Math.round((page / totalPages) * 100))
        : Math.min(99, Math.round((1 - 1 / (page + 1)) * 100));
}

// Single-page GHL GET (pipeline detection — not a full paginate).
// Single GHL GET (pipeline detection). No `limit` — the pipelines endpoint
// rejects unexpected query params with a 422; it only accepts locationId.
async function ghlFetch(path, accessToken, locationId, locationParam = 'location_id') {
    const url = new URL(`${API_BASE}${path}`);
    if (locationId) url.searchParams.set(locationParam, locationId);
    return ghlFetchUrl(url.toString(), accessToken);
}

// Validate a Private Integration Token against a Location: GET /locations/{id}.
// Returns { id, name } on success; throws on a bad token/location (used by
// addAccount to reject invalid credentials before persisting).
export async function fetchLocation(accessToken, locationId) {
    const url = `${API_BASE}/locations/${encodeURIComponent(locationId)}`;
    const body = await ghlFetchUrl(url, accessToken);
    const loc = body.location ?? body;
    return { id: loc.id ?? locationId, name: loc.name ?? null };
}

// Page through a GHL collection endpoint. GHL paginates via meta.nextPageUrl
// (preferred — carries startAfter/startAfterId baked in) and falls back to
// startAfter/startAfterId query params. arrayKey is the response key holding the
// rows (e.g. 'contacts', 'opportunities'). locationParam differs per endpoint
// (/contacts uses locationId; /opportunities/search uses location_id). onPage
// receives (page, totalPages|null, runningCount) for live progress. Bounded by
// maxPages so a foreground pull stays finite. Returns the flat array.
async function ghlFetchAll(path, accessToken, locationId, { arrayKey, locationParam = 'location_id', maxPages = MAX_PAGES, onPage = null } = {}) {
    const out = [];
    let url = new URL(`${API_BASE}${path}`);
    if (locationId) url.searchParams.set(locationParam, locationId);
    url.searchParams.set('limit', String(PER_PAGE));
    let page = 1;
    for (;;) {
        const body = await ghlFetchUrl(url.toString(), accessToken);
        const items = Array.isArray(body[arrayKey]) ? body[arrayKey] : [];
        out.push(...items);
        const total = Number(body.meta?.total);
        const totalPages = Number.isFinite(total) && total > 0
            ? Math.min(Math.ceil(total / PER_PAGE), maxPages)
            : null;
        if (onPage) onPage(page, totalPages, out.length);
        const next = body.meta?.nextPageUrl;
        const startAfter = body.meta?.startAfter;
        const startAfterId = body.meta?.startAfterId;
        const done = items.length < PER_PAGE || (!next && startAfterId == null);
        if (done) break;
        if (page >= maxPages) {
            console.warn(`[gohighlevel] ${path}: hit ${maxPages}-page cap (${out.length} rows), stopping this run`);
            break;
        }
        if (next) {
            url = new URL(next);
            if (!url.searchParams.get('limit')) url.searchParams.set('limit', String(PER_PAGE));
        } else {
            url = new URL(`${API_BASE}${path}`);
            if (locationId) url.searchParams.set(locationParam, locationId);
            url.searchParams.set('limit', String(PER_PAGE));
            if (startAfter != null) url.searchParams.set('startAfter', String(startAfter));
            if (startAfterId != null) url.searchParams.set('startAfterId', String(startAfterId));
        }
        page++;
    }
    return out;
}

// Dedup-aware upsert of ONE GHL contact (row built by contactRow). Match
// priority mirrors matchOrCreateContact so the contact PULL and the
// per-opportunity match never create competing rows for the same person:
//   1. ghl_contact_id  -> already a GHL contact: refresh its details
//   2. email           -> existing contact (Dentally/manual/CSV): link the GHL
//                          id only, never clobber its source/name
//   3. normalised phone -> same as email
//   4. none             -> insert a new gohighlevel contact
// Linking on match (not inserting) is what prevents duplicates across sources.
export async function upsertContact(orgId, c, db = supabase_1.serviceClient) {
    if (c.ghl_contact_id) {
        const { data } = await db.from('contacts').select('id')
            .eq('organisation_id', orgId).eq('ghl_contact_id', c.ghl_contact_id).maybeSingle();
        if (data) {
            await db.from('contacts').update({
                first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone,
                integration_account_id: c.integration_account_id || undefined,
            }).eq('id', data.id);
            return { id: data.id, action: 'update' };
        }
    }
    if (c.email) {
        const { data } = await db.from('contacts').select('id')
            .eq('organisation_id', orgId).ilike('email', c.email).maybeSingle();
        if (data) {
            await db.from('contacts').update({ ghl_contact_id: c.ghl_contact_id, integration_account_id: c.integration_account_id || undefined }).eq('id', data.id);
            return { id: data.id, action: 'merge_email' };
        }
    }
    if (c.phone) {
        const norm = normalizePhone(c.phone);
        if (norm) {
            const { data } = await db.from('contacts').select('id')
                .eq('organisation_id', orgId).ilike('phone', `%${norm}%`).limit(1);
            if (data?.length) {
                await db.from('contacts').update({ ghl_contact_id: c.ghl_contact_id, integration_account_id: c.integration_account_id || undefined }).eq('id', data[0].id);
                return { id: data[0].id, action: 'merge_phone' };
            }
        }
    }
    const { error } = await db.from('contacts').upsert({
        organisation_id: orgId, source: 'gohighlevel', ghl_contact_id: c.ghl_contact_id,
        practice_id: c.practice_id,
        integration_account_id: c.integration_account_id,
        first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone,
        ...(c.created_at ? { created_at: c.created_at } : {})
    }, { onConflict: 'organisation_id,ghl_contact_id' });
    if (error) return { error: error.message };
    return { action: 'insert' };
}

export async function matchOrCreateContact(orgId, c, practiceId, db = supabase_1.serviceClient, integrationAccountId = null) {
    if (!c || !c.ghl_contact_id) return null;
    const { data: existing } = await db.from('contacts')
        .select('id')
        .eq('organisation_id', orgId)
        .eq('ghl_contact_id', c.ghl_contact_id)
        .maybeSingle();
    if (existing) return existing.id;

    if (c.email) {
        const { data } = await db.from('contacts').select('id')
            .eq('organisation_id', orgId).ilike('email', c.email).maybeSingle();
        if (data) {
            await db.from('contacts').update({
                ghl_contact_id: c.ghl_contact_id,
                practice_id: practiceId,
                integration_account_id: integrationAccountId,
            }).eq('id', data.id);
            return data.id;
        }
    }

    if (c.phone) {
        const norm = normalizePhone(c.phone);
        if (norm) {
            const { data } = await db.from('contacts').select('id, phone')
                .eq('organisation_id', orgId).ilike('phone', `%${norm}%`).limit(1);
            if (data?.length) {
                await db.from('contacts').update({
                    ghl_contact_id: c.ghl_contact_id,
                    practice_id: practiceId,
                    integration_account_id: integrationAccountId,
                }).eq('id', data[0].id);
                return data[0].id;
            }
        }
    }

    const newRow = {
        organisation_id: orgId,
        practice_id: practiceId,
        integration_account_id: integrationAccountId,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        ghl_contact_id: c.ghl_contact_id,
        source: 'gohighlevel',
    };
    if (c.ghl_contact_id) {
        const { data: up, error } = await db.from('contacts').upsert(newRow, { onConflict: 'organisation_id,ghl_contact_id' }).select('id').single();
        if (error) throw new Error(`contact upsert failed: ${error.message}`);
        return up.id;
    }
    // No ghl_contact_id: no unique index to lean on (email/phone collisions are
    // legitimately shared by families), so this stays a best-effort insert.
    const { data: created, error } = await db.from('contacts').insert(newRow).select('id').single();
    if (error) throw new Error(`contact insert failed: ${error.message}`);
    return created.id;
}

// Ensure the access token is fresh. With the API-key (broker) connect there is
// no expiry and nothing to refresh (expires_at is null), so use the key as-is.
// The OAuth-era refresh path is kept for any legacy row that still carries an
// expires_at.
async function ensureFreshToken(orgId, integration) {
    if (!integration.expires_at) return integration; // API key — long-lived
    const exp = Date.parse(integration.expires_at);
    if (exp && exp - Date.now() > 60_000) return integration; // > 60s left
    await GoHighLevelProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'gohighlevel');
}

// Map+upsert ONE GHL opportunity -> a lead (match-or-create its contact first).
// Shared by the poll AND the webhook so both stay consistent. Idempotent on
// (organisation_id, ghl_opportunity_id). db is injectable for tests. contactMap
// (ghl_contact_id -> our id), when supplied, resolves the contact in O(1) from
// the already-synced contact book instead of 3 lookups per opportunity — only
// opps whose contact isn't found fall back to match-or-create.
export async function upsertOpportunity(orgId, opp, practiceId, stageMappings = {}, db = supabase_1.serviceClient, contactMap = null, stageNameMap = null, integrationAccountId = null) {
    if (!opp || opp.id == null) return { ok: false, skipped: 'no_opportunity_id' };
    const contact = extractContact(opp);
    let contactId = contactMap && contact.ghl_contact_id ? (contactMap.get(String(contact.ghl_contact_id)) ?? null) : null;
    if (!contactId) contactId = await matchOrCreateContact(orgId, contact, practiceId, db, integrationAccountId);
    if (!contactId) return { ok: false, skipped: 'contact_creation_failed' };
    // Stage name: prefer the payload, else resolve the id from the pipeline map.
    const stageName = opp.stageName ?? opp.pipelineStageName
        ?? (stageNameMap && opp.pipelineStageId ? stageNameMap.get(String(opp.pipelineStageId)) : null)
        ?? null;
    const status = mapStage(opp.pipelineStageId, stageName, stageMappings);
    // Real GHL creation date — without this, leads.created_at defaults to the
    // sync time, so "new leads today" counts everything pulled today, not what
    // GHL actually created today.
    const rawCreated = opp.createdAt ?? opp.dateAdded ?? opp.created_at ?? null;
    let createdIso = null;
    if (rawCreated != null) {
        const d = new Date(rawCreated);
        if (!Number.isNaN(d.getTime())) createdIso = d.toISOString();
    }
    const { error } = await db.from('leads').upsert({
        organisation_id: orgId,
        contact_id: contactId,
        practice_id: practiceId,
        integration_account_id: integrationAccountId,
        ghl_opportunity_id: opp.id,
        ghl_pipeline_id: opp.pipelineId ?? null,
        // Raw GHL stage — lets the Pipeline screen render real GHL stages dynamically.
        ghl_pipeline_stage_id: opp.pipelineStageId ?? null,
        ghl_stage_name: stageName,
        treatment: opp.name ?? 'Enquiry',
        estimated_value_pence: toPence(opp.monetaryValue),
        status,
        sync_status: 'synced',
        source: 'gohighlevel',
        ...(createdIso ? { created_at: createdIso } : {}),
    }, { onConflict: 'organisation_id,ghl_opportunity_id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

// Load the org's existing-contact dedup maps in ONE paginated scan, so the
// contact pull can classify thousands of contacts in memory instead of issuing
// 3 lookups per contact (which made an 8k-contact pull take ~an hour).
async function loadContactDedupMaps(orgId) {
    const byGhl = new Map();   // ghl_contact_id -> our id
    const byEmail = new Map(); // lower(email)   -> { id, ghl }
    const byPhone = new Map(); // normphone      -> { id, ghl }
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data } = await supabase_1.serviceClient
            .from('contacts').select('id, ghl_contact_id, email, phone')
            .eq('organisation_id', orgId).range(from, from + PAGE - 1);
        const rows = data ?? [];
        for (const c of rows) {
            if (c.ghl_contact_id) byGhl.set(String(c.ghl_contact_id), c.id);
            const e = c.email ? String(c.email).toLowerCase() : null;
            if (e && !byEmail.has(e)) byEmail.set(e, { id: c.id, ghl: c.ghl_contact_id });
            const np = normalizePhone(c.phone);
            if (np && !byPhone.has(np)) byPhone.set(np, { id: c.id, ghl: c.ghl_contact_id });
        }
        if (rows.length < PAGE) break;
    }
    return { byGhl, byEmail, byPhone };
}

// Pull the contact book (paginated) and reconcile in BULK. Classify each remote
// contact against the preloaded maps: already-GHL or brand-new -> bulk upsert on
// (org, ghl_contact_id); matches an existing Dentally/manual/CSV contact by
// email/phone -> link the GHL id onto that row (dedup, no duplicate). This keeps
// the same dedup guarantee as upsertContact but at a few dozen queries instead
// of ~3 per contact — an 8k pull goes from ~an hour to seconds.
async function pullContacts(orgId, accessToken, locationId, practiceId, onPage = () => {}, maxPages = MAX_PAGES, integrationAccountId = null, since = null) {
    const fetched = await ghlFetchAll('/contacts/', accessToken, locationId, {
        arrayKey: 'contacts', locationParam: 'locationId', maxPages, onPage,
    });
    // Incremental window: GHL's /contacts/ list cannot filter server-side, so
    // the walk is unavoidable — but rows unchanged since `since` need no write.
    // A contact with no update timestamp is kept (never silently dropped).
    const sinceMs = since == null ? null : Date.parse(since);
    const remote = sinceMs == null ? fetched : fetched.filter((rc) => {
        const raw = rc?.dateUpdated ?? rc?.updatedAt ?? null;
        if (raw == null) return true;
        const t = Date.parse(raw);
        return Number.isNaN(t) || t >= sinceMs;
    });
    const { byGhl, byEmail, byPhone } = await loadContactDedupMaps(orgId);
    const toUpsert = [];
    const toLink = []; // { id, ghl_contact_id } — existing non-GHL row to relink
    for (const rc of remote) {
        if (!rc || rc.id == null) continue;
        const r = contactRow(orgId, rc, practiceId, integrationAccountId);
        const g = String(r.ghl_contact_id);
        if (byGhl.has(g)) { toUpsert.push(r); continue; } // already linked -> refresh
        const e = r.email ? String(r.email).toLowerCase() : null;
        if (e && byEmail.has(e)) {
            const ex = byEmail.get(e);
            if (String(ex.ghl ?? '') !== g) { toLink.push({ id: ex.id, ghl_contact_id: g }); byGhl.set(g, ex.id); }
            continue;
        }
        const np = normalizePhone(r.phone);
        if (np && byPhone.has(np)) {
            const ex = byPhone.get(np);
            if (String(ex.ghl ?? '') !== g) { toLink.push({ id: ex.id, ghl_contact_id: g }); byGhl.set(g, ex.id); }
            continue;
        }
        toUpsert.push(r); // new
    }
    let synced = 0;
    let failed = 0;
    for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK) {
        const chunk = toUpsert.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase_1.serviceClient.from('contacts').upsert(chunk, { onConflict: 'organisation_id,ghl_contact_id' });
        if (!error) { synced += chunk.length; }
        else {
            for (const row of chunk) {
                const { error: e2 } = await supabase_1.serviceClient.from('contacts').upsert([row], { onConflict: 'organisation_id,ghl_contact_id' });
                if (e2) failed++; else synced++;
            }
        }
        if (onPage) onPage(i + chunk.length, toUpsert.length, synced); // progress during the write phase
    }
    for (const lk of toLink) {
        const { error } = await supabase_1.serviceClient.from('contacts')
            .update({ ghl_contact_id: lk.ghl_contact_id, integration_account_id: integrationAccountId || undefined }).eq('id', lk.id).eq('organisation_id', orgId);
        if (!error) synced++;
    }
    if (failed) console.warn(`[gohighlevel] contacts: skipped ${failed} unstorable row(s)`);
    return synced;
}

export async function syncOneOrg(orgId, integrationRow, onProgress = () => {}, { full = false, recent = false } = {}) {
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
    const maxPages = (full || recent) ? BOOTSTRAP_MAX_PAGES : MAX_PAGES;
    // Always pull the contact book — routine Refresh included — so a newly added
    // GHL contact surfaces without needing a full backfill. Bounded by maxPages
    // (routine cap) so it stays fast; matches the Dentally precedent of pulling
    // patients every sync. Opportunities are a second phase.
    const withContacts = true;

    try {
        // Pre-register the phases this run will walk, in order, so the overlay
        // lists every resource (Contacts, Opportunities, Conversations) as
        // "Waiting" up front instead of revealing each only as it starts.
        // `parallel: true` tells the UI this run's phases track independently
        // (contacts + opportunities fetch concurrently), so it uses each phase's
        // own `done` flag for completion instead of sequential position.
        onProgress({ expectedPhases: ['contacts', 'opportunities', 'conversations'], parallel: true });

        // Each phase tracks its OWN percentage independently (phasePct) so the UI
        // shows separate live bars; the overall top bar is the average across the
        // three phases. `report` recomputes overall on every per-phase tick.
        const own = { contacts: 0, opportunities: 0, conversations: 0 };
        const overall = () => Math.min(99, Math.round((own.contacts + own.opportunities + own.conversations) / 3));
        const report = (phase, page, totalPages, count) => {
            own[phase] = withinPct(page, totalPages);
            onProgress({ phase, pct: overall(), phasePct: own[phase], page, totalPages, count });
        };
        const phaseDone = (phase, count) => {
            own[phase] = 100;
            onProgress({ phase, pct: overall(), phasePct: 100, phaseDone: true, ...(count != null ? { count } : {}) });
        };

        // Contacts + opportunities are independent GHL reads — fetch them
        // CONCURRENTLY so both phase bars advance at once. (Each endpoint still
        // paginates internally by cursor, which is unavoidably sequential.) The
        // opportunity UPSERT below waits for contacts — it resolves each opp's
        // contact from the synced book — but the network pulls fully overlap, so
        // wall-clock is max(contacts, opps) instead of their sum.
        let contactsSynced = 0;
        const [cs, opportunities] = await Promise.all([
            withContacts
                ? pullContacts(orgId, access_token, locationId, null,
                    (page, totalPages, count) => report('contacts', page, totalPages, count), maxPages)
                : Promise.resolve(0),
            ghlFetchAll('/opportunities/search', access_token, locationId, {
                arrayKey: 'opportunities', locationParam: 'location_id', maxPages,
                onPage: (page, totalPages, count) => report('opportunities', page, totalPages, count),
            }),
        ]);
        contactsSynced = cs;
        phaseDone('contacts', contactsSynced);
        // Cache the pipeline definitions (id/name + ordered stages) on the
        // integration config so the Pipeline screen can render them dynamically,
        // and build a stageId -> name map to stamp on each lead. Non-fatal.
        let stageNameMap = null;
        try {
            const { pipelines = [] } = await detectPipelines(orgId, integration);
            if (pipelines.length) {
                await integrationRepository.mergeConfig(orgId, 'gohighlevel', { pipelines });
                stageNameMap = new Map();
                for (const p of pipelines) for (const s of p.stages ?? []) stageNameMap.set(String(s.id), s.name);
            }
        } catch (err) {
            console.warn(`[gohighlevel] pipelines fetch skipped: ${err?.message || err}`);
        }
        // Cache the GHL workflows (Automations screen) — id/name/status only;
        // GHL's API doesn't expose sent/conversion per workflow. Non-fatal.
        try {
            const wf = await ghlFetch('/workflows/', access_token, locationId, 'locationId');
            const workflows = (wf.workflows ?? []).map((w) => ({
                id: w.id, name: w.name ?? w.id, status: w.status ?? null, updatedAt: w.updatedAt ?? null,
            }));
            await integrationRepository.mergeConfig(orgId, 'gohighlevel', { workflows });
        } catch (err) {
            console.warn(`[gohighlevel] workflows fetch skipped: ${err?.message || err}`);
        }
        // Resolve opp contacts from the already-synced contact book (one scan)
        // instead of 3 lookups per opportunity.
        const { byGhl: oppContactMap } = await loadContactDedupMaps(orgId);
        // Upsert opportunities in bounded-concurrency batches rather than one DB
        // round-trip at a time: a 2.6k-opp account was ~2.6k sequential awaits
        // (minutes of silent work that tripped the UI stall guard). Each upsert is
        // idempotent (onConflict on ghl_opportunity_id) and resolves its contact
        // from oppContactMap in memory, so OPP_CONCURRENCY parallel writes are safe
        // and finish in seconds. Emit progress per batch so `at` stays fresh (no
        // false "stuck" stall) and the bar advances through the link phase.
        let synced = 0;
        for (let i = 0; i < opportunities.length; i += OPP_CONCURRENCY) {
            const batch = opportunities.slice(i, i + OPP_CONCURRENCY);
            const results = await Promise.all(batch.map((opp) =>
                upsertOpportunity(orgId, opp, null, stageMappings, supabase_1.serviceClient, oppContactMap, stageNameMap)));
            synced += results.filter((r) => r.ok).length;
            // Advance the opportunities phase across the link/write step too (its
            // own bar from the fetch already sits near 100); keeps `at` fresh.
            report('opportunities', i + batch.length, opportunities.length, opportunities.length);
        }
        phaseDone('opportunities', opportunities.length);

        // Conversations -> communications (Inbox). Runs after contacts so the
        // ghl_contact_id -> contact map is fresh. Non-fatal: a failure here must
        // not abort the contacts/opportunities sync. Wrap its progress so the
        // conversations phase reports its OWN percentage (walked / total threads).
        let conversations = { conversations: 0, messages: 0 };
        try {
            report('conversations', 0, null, 0);
            conversations = await syncConversations(orgId, integration, {
                onProgress: (p) => report('conversations', p.count ?? 0, p.totalPages ?? null, p.count ?? 0),
            });
            phaseDone('conversations', conversations.conversations);
        } catch (err) {
            console.warn(`[gohighlevel] conversations sync skipped: ${err?.message || err}`);
        }
        await integrationRepository.upsert(orgId, 'gohighlevel', {
            last_sync_at: new Date().toISOString(),
            last_error: null,
            status: 'active',
        });
        return { contacts: contactsSynced, opportunities: synced, total: opportunities.length, messages: conversations.messages };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'gohighlevel', String(err.message).slice(0, 500));
        throw err;
    }
}

// Real-time webhook apply (single record). resourceType from
// mapWebhookEventType. Reuses the same row builders / upsert path as the poll.
// Opportunity delete removes the GHL-mastered lead; contact delete is ignored
// (never cascade-delete a contact from a CRM event). Idempotent.
export async function applyWebhookEvent(orgId, eventType, record, integrationAccountId = null) {
    if (!eventType) return { ignored: 'unknown_event' };
    if (!record || record.id == null) return { ignored: 'no_record_id' };
    
    const account = integrationAccountId ? await integrationAccountRepository.getById(orgId, integrationAccountId) : null;
    const practiceId = account?.practice_id ?? null;
    
    if (eventType === 'contact') {
        await upsertContact(orgId, contactRow(orgId, record, practiceId, integrationAccountId), supabase_1.serviceClient);
        return { table: 'contacts', applied: 1 };
    }
    if (eventType === 'opportunity') {
        const stageMappings = account?.config?.stage_mappings ?? {};
        const r = await upsertOpportunity(orgId, record, practiceId, stageMappings, supabase_1.serviceClient, null, null, integrationAccountId);
        return r.ok ? { table: 'leads', applied: 1 } : { skipped: r.error ?? r.skipped };
    }
    if (eventType === 'opportunity_delete') {
        const { error } = await supabase_1.serviceClient.from('leads')
            .delete().eq('organisation_id', orgId).eq('ghl_opportunity_id', String(record.id));
        if (error) return { skipped: error.message };
        return { table: 'leads', deleted: 1 };
    }
    return { ignored: eventType };
}

// List the org's GHL pipelines + their stages, to drive the stage-mapping UI
// (owner maps each GHL stage -> an Elevate lead status). Returns a shape the
// frontend renders directly. Never throws to the caller for a missing token.
export async function detectPipelines(orgId, integration) {
    let integ = integration ?? await integrationRepository.getByProvider(orgId, 'gohighlevel');
    if (!integ?.secrets) return { pipelines: [], error: 'no_auth' };
    integ = await ensureFreshToken(orgId, integ);
    const { access_token } = JSON.parse(decryptSecret(integ.secrets));
    const locationId = integ.config?.locationId;
    if (!access_token || !locationId) return { pipelines: [], error: 'no_location' };
    const body = await ghlFetch('/opportunities/pipelines', access_token, locationId, 'locationId');
    const pipelines = (body.pipelines ?? []).map((p) => ({
        id: p.id,
        name: p.name ?? p.id,
        stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name ?? s.id })),
    }));
    return { pipelines };
}

// First-connect automation (mirrors the Dentally bootstrap shape). GHL has no
// "sites" to detect/map, so the bootstrap is simply a full-history pull of
// contacts + opportunities with progress. Stage mapping is owner-configured
// later (heuristic default until then), so it doesn't gate the first pull.
export async function bootstrapOnConnect(orgId, integration, onProgress = () => {}) {
    return syncOneOrg(orgId, integration, onProgress, { recent: true });
}

// --- GHL calendar + appointment sync (Phase 3 of syncAccount) ---------------

// List all calendars for a GHL location. Returns [{ id, name }].
// On any error (missing scope, 401, network) returns [] — callers treat empty
// as "no calendars" and skip the phase, not as a hard failure.
export async function fetchCalendars(accessToken, locationId) {
    if (!accessToken || !locationId) return [];
    const body = await ghlFetch('/calendars/', accessToken, locationId, 'locationId');
    return (body.calendars ?? []).map((c) => ({ id: String(c.id), name: c.name ?? c.id }));
}

// Pull all calendar events in a ±90-day window for every calendar in the
// location, then upsert them via ghlAppointmentRepository. Defensive: a
// per-calendar failure is caught and logged without aborting the others.
// Returns { appointments: <total upserted>, calendars: <number of calendars> }.
export async function pullAppointments(orgId, account, accessToken, locationId, contactMap, onProgress = () => {}) {
    const calendars = await fetchCalendars(accessToken, locationId);
    if (!calendars.length) return { appointments: 0, calendars: 0 };
    const now = Date.now();
    const startTime = String(now - 90 * 86_400_000);
    const endTime = String(now + 90 * 86_400_000);
    let total = 0;
    for (let i = 0; i < calendars.length; i++) {
        const cal = calendars[i];
        try {
            // ghlFetch uses new URL(API_BASE + path) then url.searchParams.set(locationParam, locationId).
            // Constructing the path with existing query params is safe — URL() parses the ?-portion
            // correctly and searchParams.set appends the locationId without clobbering other params.
            const path = `/calendars/events?calendarId=${encodeURIComponent(cal.id)}&startTime=${startTime}&endTime=${endTime}`;
            const body = await ghlFetch(path, accessToken, locationId, 'locationId');
            const events = body.events ?? [];
            const rows = events
                .map((e) => appointmentRow(orgId, account, e, cal.name, contactMap))
                .filter((r) => r.ghl_event_id);
            total += await ghlAppointmentRepository.upsertMany(rows);
        } catch (err) {
            console.warn(`[gohighlevel] account ${account.id} calendar ${cal.id} events skipped: ${err?.message || err}`);
        }
        onProgress({
            phase: 'appointments',
            pct: Math.round(((i + 1) / calendars.length) * 100),
            page: i + 1,
            totalPages: calendars.length,
            count: total,
        });
    }
    return { appointments: total, calendars: calendars.length };
}

// Account-driven sync: same pull/upsert engine as syncOneOrg, but creds come
// from an integration_accounts row (its own PIT + locationId), pipelines/last_sync
// persist to the account row. This is the multi-subaccount path.
export async function syncAccount(orgId, accountId, onProgress = () => {}, { full = false, recent = false } = {}) {
    const account = await integrationAccountRepository.getByIdWithSecrets(orgId, accountId);
    if (!account || account.status === 'revoked' || !account.secrets) {
        return { synced: 0, skipped: 'inactive' };
    }
    const { access_token } = JSON.parse(decryptSecret(account.secrets));
    const locationId = account.external_account_id;
    if (!access_token || !locationId) return { synced: 0, skipped: 'no_location' };
    const stageMappings = account.config?.stage_mappings ?? {};
    const maxPages = (full || recent) ? BOOTSTRAP_MAX_PAGES : MAX_PAGES;
    // Incremental window for routine runs: only rows changed since the last
    // successful sync get written (and conversations paged). 24h margin absorbs
    // clock skew and a partially-failed previous run; full/recent pulls and
    // first-ever runs (no last_sync_at) take no window.
    const SINCE_MARGIN_MS = 24 * 60 * 60 * 1000;
    const since = (!full && !recent && account.last_sync_at)
        ? new Date(new Date(account.last_sync_at).getTime() - SINCE_MARGIN_MS).toISOString()
        : null;
    const nPhases = 2;
    try {
        const contactsSynced = await pullContacts(orgId, access_token, locationId, account.practice_id,
            (page, totalPages, count) => onProgress({ phase: 'contacts', pct: phasePct(0, nPhases, page, totalPages), page, totalPages, count }),
            maxPages, accountId, since);
        const opportunities = await ghlFetchAll('/opportunities/search', access_token, locationId, {
            arrayKey: 'opportunities', locationParam: 'location_id', maxPages,
            onPage: (page, totalPages, count) => onProgress({ phase: 'opportunities', pct: phasePct(1, nPhases, page, totalPages), page, totalPages, count }),
        });
        let stageNameMap = null;
        try {
            const { pipelines = [] } = await detectPipelinesForToken(access_token, locationId);
            if (pipelines.length) {
                await integrationAccountRepository.mergeConfig(orgId, accountId, { pipelines });
                stageNameMap = new Map();
                for (const p of pipelines) for (const s of p.stages ?? []) stageNameMap.set(String(s.id), s.name);
            }
        } catch (err) {
            console.warn(`[gohighlevel] account ${accountId} pipelines skipped: ${err?.message || err}`);
        }
        try {
            const wf = await ghlFetch('/workflows/', access_token, locationId, 'locationId');
            const workflows = (wf.workflows ?? []).map((w) => ({
                id: w.id, name: w.name ?? w.id, status: w.status ?? null, updatedAt: w.updatedAt ?? null,
            }));
            await integrationAccountRepository.mergeConfig(orgId, accountId, { workflows });
        } catch (err) {
            console.warn(`[gohighlevel] account ${accountId} workflows skipped: ${err?.message || err}`);
        }
        const { byGhl: oppContactMap } = await loadContactDedupMaps(orgId);
        const sinceMs = since == null ? null : Date.parse(since);
        let synced = 0;
        for (const opp of opportunities) {
            // Incremental window: an opportunity untouched since the last sync
            // upserts to the identical row — skip the round trip. Missing
            // timestamps are treated as fresh (never silently dropped).
            if (sinceMs != null) {
                const raw = opp?.updatedAt ?? opp?.dateUpdated ?? null;
                const t = raw == null ? NaN : Date.parse(raw);
                if (!Number.isNaN(t) && t < sinceMs) continue;
            }
            const r = await upsertOpportunity(orgId, opp, account.practice_id, stageMappings, supabase_1.serviceClient, oppContactMap, stageNameMap, accountId);
            if (r.ok) synced++;
        }
        // Phase 3: calendar appointments — DEFENSIVE. A missing calendars scope
        // on the PIT (404/401) must never break contacts+opportunities sync.
        let apptResult = { appointments: 0 };
        try {
            apptResult = await pullAppointments(orgId, account, access_token, locationId, oppContactMap, onProgress);
        } catch (err) {
            console.warn(`[gohighlevel] account ${accountId} appointments phase skipped: ${err?.message || err}`);
        }
        // Phase 4: conversations -> Inbox — DEFENSIVE like appointments (a PIT
        // without conversations scopes must not fail the sync). Account-scoped
        // replacement for the retired legacy org-level conversations pull;
        // newest-first + `since` keeps routine runs to what actually changed.
        let convResult = { conversations: 0, messages: 0 };
        try {
            convResult = await syncConversations(orgId, { secrets: account.secrets, config: { locationId } }, {
                since, integrationAccountId: accountId, onProgress,
                maxConversations: (full || recent) ? 5000 : 1000,
            });
        } catch (err) {
            console.warn(`[gohighlevel] account ${accountId} conversations phase skipped: ${err?.message || err}`);
        }
        await integrationAccountRepository.markSynced(orgId, accountId);
        return {
            contacts: contactsSynced, opportunities: synced, total: opportunities.length,
            appointments: apptResult.appointments,
            conversations: convResult.conversations, messages: convResult.messages,
        };
    } catch (err) {
        // Don't let a markFailed failure mask the real sync error.
        try {
            await integrationAccountRepository.markFailed(orgId, accountId, String(err.message));
        } catch (markErr) {
            console.error(`[gohighlevel] account ${accountId} markFailed failed:`, markErr?.message || markErr);
        }
        throw err;
    }
}

export async function bootstrapAccount(orgId, accountId, onProgress = () => {}) {
    return syncAccount(orgId, accountId, onProgress, { recent: true });
}

export async function detectPipelinesForToken(accessToken, locationId) {
    if (!accessToken || !locationId) return { pipelines: [], error: 'no_location' };
    const body = await ghlFetch('/opportunities/pipelines', accessToken, locationId, 'locationId');
    const pipelines = (body.pipelines ?? []).map((p) => ({
        id: p.id, name: p.name ?? p.id,
        stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name ?? s.id })),
    }));
    return { pipelines };
}

export async function syncAllOrgs() {
    const accounts = await integrationAccountRepository.listAllSyncable('gohighlevel');
    const results = [];
    for (const acc of accounts) {
        try {
            const r = await syncAccount(acc.organisation_id, acc.id);
            results.push({ orgId: acc.organisation_id, accountId: acc.id, ...r });
        } catch (err) {
            // One subaccount must not abort the rest — but swallowing the error
            // here is what made the July 2026 incident invisible: the cron job
            // caught its own errors, so Sentry's monitor check-in stayed green
            // while five subaccounts failed nightly for over a week. Report
            // each failure explicitly, then carry on to the next account.
            Sentry.withScope((scope) => {
                scope.setTag('integration', 'gohighlevel');
                scope.setTag('organisation_id', acc.organisation_id);
                scope.setTag('ghl_account_id', acc.id);
                scope.setContext('ghl_account', {
                    label: acc.label ?? null,
                    location_id: acc.external_account_id ?? null,
                    previous_status: acc.status ?? null,
                    last_sync_at: acc.last_sync_at ?? null,
                });
                Sentry.captureException(err);
            });
            console.error(`[gohighlevel] account ${acc.id} (${acc.label ?? 'unlabelled'}) sync failed: ${err.message}`);
            results.push({ orgId: acc.organisation_id, accountId: acc.id, error: err.message });
        }
    }
    return results;
}
