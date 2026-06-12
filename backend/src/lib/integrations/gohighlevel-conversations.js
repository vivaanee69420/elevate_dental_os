// GoHighLevel Conversations — Inbox support. Pulls conversation threads +
// their messages into our `communications` table (so the existing CRM Inbox
// renders them), and sends SMS/Email replies back out through GHL (which owns
// the contact's number/email + threads the reply). Scopes: conversations.*,
// conversations/message.*.
//
//   GET  /conversations/search?locationId=         -> threads
//   GET  /conversations/{id}/messages              -> messages in a thread
//   POST /conversations/messages                   -> send SMS/Email/WhatsApp

import { decryptSecret } from '../crypto.js';
import * as supabase_1 from '../supabase.js';

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

function tokenOf(integration) {
    return JSON.parse(decryptSecret(integration.secrets)).access_token;
}

// GHL fetch with bounded 429 retries honouring retry-after with exponential
// backoff. A full conversations backfill fires thousands of message pulls at
// concurrency, and GHL's burst limit (~100 req / 10s) returns 429 in waves; a
// single retry wasn't enough (the retry itself hit the still-open window and the
// thread was dropped). Up to 4 attempts with growing backoff lets a thread ride
// out a sustained burst instead of being skipped.
async function ghl(path, accessToken, { method = 'GET', body, retries = 4 } = {}) {
    const headers = { Authorization: `Bearer ${accessToken}`, Version: API_VERSION, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    for (let attempt = 0; attempt <= retries; attempt++) {
        res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        if (res.status !== 429 || attempt === retries) break;
        const ra = parseInt(res.headers.get('retry-after') ?? '0', 10);
        const wait = (ra > 0 ? ra * 1000 : 1000 * 2 ** attempt) + 500;
        await new Promise((r) => setTimeout(r, wait));
    }
    if (!res.ok) throw new Error(`GHL ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

// --- pure mappers (unit-tested) ------------------------------------------

// GHL message type -> our communications.channel enum
// (email|sms|whatsapp|call|in_person). Returns null for types we can't store
// (webchat/FB/IG/etc) so they're skipped rather than violating the CHECK.
export function mapMessageChannel(ghlType) {
    const t = String(ghlType || '').toUpperCase();
    if (t.includes('SMS')) return 'sms';
    if (t.includes('EMAIL')) return 'email';
    if (t.includes('WHATSAPP')) return 'whatsapp';
    if (t.includes('CALL')) return 'call';
    return null;
}

// One GHL message -> a communications row. contactId is OUR contact uuid (already
// resolved from the GHL contactId). Pure (no I/O). Returns null for unmappable
// channels.
export function messageRow(orgId, m, contactId, conversationId) {
    const channel = mapMessageChannel(m.messageType ?? m.type);
    if (!channel) return null;
    return {
        organisation_id: orgId,
        contact_id: contactId ?? null,
        channel,
        direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
        subject: m.subject ?? null,
        body: m.body ?? m.message ?? null,
        delivery_status: m.status ?? 'delivered',
        external_id: String(m.id),
        metadata: { provider: 'gohighlevel', conversationId: conversationId ?? m.conversationId ?? null, messageType: m.messageType ?? m.type ?? null },
        ...(m.dateAdded ? { created_at: m.dateAdded } : {}),
    };
}

// --- send -----------------------------------------------------------------

// Send an SMS / Email / WhatsApp to a GHL contact. contactId is the GHL contact
// id. Returns { conversationId, messageId }.
export async function sendMessage(orgId, integration, { contactId, channel, body, subject }) {
    if (!contactId) throw new Error('GHL contactId required to send');
    const at = tokenOf(integration);
    const type = channel === 'email' ? 'Email' : channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
    const payload = { type, contactId, message: body };
    if (type === 'Email') {
        payload.subject = subject || 'Message from your dental practice';
        payload.html = `<p>${String(body ?? '').replace(/\n/g, '<br/>')}</p>`;
    }
    const res = await ghl('/conversations/messages', at, { method: 'POST', body: payload });
    return {
        conversationId: res.conversationId ?? res.conversation?.id ?? null,
        messageId: res.messageId ?? (Array.isArray(res.messageIds) ? res.messageIds[0] : null),
    };
}

// --- pull -----------------------------------------------------------------

// { ghl_contact_id -> our contacts.id } for the org (paginated past the 1000 cap).
async function ourContactMap(orgId) {
    const map = new Map();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data } = await supabase_1.serviceClient
            .from('contacts').select('id, ghl_contact_id')
            .eq('organisation_id', orgId).not('ghl_contact_id', 'is', null)
            .range(from, from + PAGE - 1);
        const rows = data ?? [];
        for (const c of rows) map.set(String(c.ghl_contact_id), c.id);
        if (rows.length < PAGE) break;
    }
    return map;
}

// Run fn over items with at most `limit` in flight. Per-conversation message
// pulls are I/O-bound HTTP; sequential was ~0.75s/thread (35min for a 2.8k-thread
// account). Bounded concurrency keeps a full backfill to a few minutes without
// hammering GHL past its rate limit (the 429 retry in ghl() absorbs bursts).
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return out;
}

// Idempotent upsert of communications rows. Backed by the FULL unique index
// uq_comms_org_extid (000084). The earlier PARTIAL index (000067, WHERE
// external_id IS NOT NULL) could not be inferred by PostgREST's ON CONFLICT, so
// every conversation sync raised "no unique or exclusion constraint matching the
// ON CONFLICT specification" and silently stored 0 — the Inbox stayed empty.
// Dedupe within the batch first (same external_id twice in one pull would trip
// "affect row a second time"). Returns the count actually inserted (ignored dups
// are not selected back).
async function upsertMessages(rows) {
    if (!rows.length) return 0;
    const seen = new Set();
    const batch = rows.filter((r) => r.external_id && !seen.has(r.external_id) && seen.add(r.external_id));
    const { data, error } = await supabase_1.serviceClient.from('communications')
        .upsert(batch, { onConflict: 'organisation_id,external_id', ignoreDuplicates: true })
        .select('id');
    if (error) { console.warn(`[gohighlevel] conversations upsert: ${error.message}`); return 0; }
    return data?.length ?? 0;
}

// Pull ALL conversation threads + their recent messages into communications.
// Paginates /conversations/search via the GHL cursor (each conversation carries
// `sort: [lastMessageDate]`; the next page is startAfterDate=<last sort[0]>) until
// the account is exhausted or maxConversations is reached. Inbound + outbound
// (including replies we sent via GHL) both land here, so the Inbox is complete.
// Idempotent — safe to re-run nightly; the upsert drops messages already stored.
export async function syncConversations(orgId, integration, { maxConversations = 5000, perConv = 50, pageSize = 100, concurrency = 8, onProgress = null } = {}) {
    const at = tokenOf(integration);
    const locationId = integration.config?.locationId;
    if (!at || !locationId) return { conversations: 0, messages: 0 };
    const cmap = await ourContactMap(orgId);
    onProgress?.({ phase: 'conversations', pct: 99, count: 0, page: 0, totalPages: null });
    let cursor = null;
    let convCount = 0;
    let inserted = 0;
    while (convCount < maxConversations) {
        const limit = Math.min(pageSize, maxConversations - convCount);
        const q = `/conversations/search?locationId=${locationId}&limit=${limit}` +
            (cursor != null ? `&startAfterDate=${cursor}` : '');
        const convRes = await ghl(q, at);
        const conversations = convRes.conversations ?? [];
        if (!conversations.length) break;
        convCount += conversations.length;
        // Fetch each thread's messages concurrently, then upsert the page. Stream
        // the running thread count so the overlay shows live progress and `at`
        // stays fresh through a multi-thousand-thread backfill.
        const perConvRows = await mapLimit(conversations, concurrency, async (c) => {
            const contactId = cmap.get(String(c.contactId)) ?? null;
            try {
                const mRes = await ghl(`/conversations/${c.id}/messages?limit=${perConv}`, at);
                const msgs = mRes.messages?.messages ?? mRes.messages ?? [];
                return msgs.map((m) => messageRow(orgId, m, contactId, c.id)).filter(Boolean);
            } catch (e) {
                console.warn(`[gohighlevel] messages for conversation ${c.id} skipped: ${e.message}`);
                return [];
            }
        });
        inserted += await upsertMessages(perConvRows.flat());
        onProgress?.({ phase: 'conversations', pct: 99, count: convCount, page: convCount, totalPages: null });
        // Advance the cursor to the oldest thread on this page. Stop on a short
        // page (account exhausted) or a missing cursor.
        const last = conversations[conversations.length - 1];
        const next = last?.sort?.[0] ?? last?.lastMessageDate ?? null;
        if (next == null || conversations.length < limit) break;
        cursor = next;
    }
    return { conversations: convCount, messages: inserted };
}
