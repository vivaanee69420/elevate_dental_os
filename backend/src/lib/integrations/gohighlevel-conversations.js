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

// GHL fetch with one 429 retry honouring retry-after (+500ms).
async function ghl(path, accessToken, { method = 'GET', body } = {}) {
    const headers = { Authorization: `Bearer ${accessToken}`, Version: API_VERSION, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429) {
        const ra = parseInt(res.headers.get('retry-after') ?? '2', 10);
        await new Promise((r) => setTimeout(r, ra * 1000 + 500));
        res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

// Pull conversation threads + their recent messages into communications.
// Idempotent: skips messages whose external_id already exists for the org (no
// ON CONFLICT needed, so no dependence on a unique index). Inbound + outbound
// (including replies we sent via GHL) both land here, so the Inbox is complete.
export async function syncConversations(orgId, integration, { maxConversations = 100, perConv = 50 } = {}) {
    const at = tokenOf(integration);
    const locationId = integration.config?.locationId;
    if (!at || !locationId) return { conversations: 0, messages: 0 };
    const cmap = await ourContactMap(orgId);
    const convRes = await ghl(`/conversations/search?locationId=${locationId}&limit=${Math.min(maxConversations, 100)}`, at);
    const conversations = convRes.conversations ?? [];
    const rows = [];
    for (const c of conversations) {
        const contactId = cmap.get(String(c.contactId)) ?? null;
        try {
            const mRes = await ghl(`/conversations/${c.id}/messages?limit=${perConv}`, at);
            const msgs = mRes.messages?.messages ?? mRes.messages ?? [];
            for (const m of msgs) {
                const row = messageRow(orgId, m, contactId, c.id);
                if (row) rows.push(row);
            }
        } catch (e) {
            console.warn(`[gohighlevel] messages for conversation ${c.id} skipped: ${e.message}`);
        }
    }
    let inserted = 0;
    if (rows.length) {
        const ids = rows.map((r) => r.external_id);
        const { data: existing } = await supabase_1.serviceClient
            .from('communications').select('external_id')
            .eq('organisation_id', orgId).in('external_id', ids);
        const have = new Set((existing ?? []).map((e) => e.external_id));
        const fresh = rows.filter((r) => !have.has(r.external_id));
        if (fresh.length) {
            const { error } = await supabase_1.serviceClient.from('communications').insert(fresh);
            if (error) console.warn(`[gohighlevel] conversations insert: ${error.message}`);
            else inserted = fresh.length;
        }
    }
    return { conversations: conversations.length, messages: inserted };
}
