// GoHighLevel sync — pure mapping helpers + contact match/create priority.
import { describe, it, expect } from 'vitest';
import {
    toPence, normalizePhone, mapStage, extractContact, matchOrCreateContact,
    contactRow, mapWebhookEventType, phasePct, upsertOpportunity, applyWebhookEvent, upsertContact,
} from '../src/lib/integrations/gohighlevel-sync.js';

describe('toPence', () => {
    it('converts major units to integer pence, no float drift', () => {
        expect(toPence(45)).toBe(4500);
        expect(toPence(45.5)).toBe(4550);
        expect(toPence('32.10')).toBe(3210);
        expect(toPence(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    });
    it('handles null/NaN as 0', () => {
        expect(toPence(null)).toBe(0);
        expect(toPence(undefined)).toBe(0);
        expect(toPence('abc')).toBe(0);
    });
});

describe('normalizePhone', () => {
    it('converges +44 / 0-prefix / bare formats', () => {
        expect(normalizePhone('+44 7700 900123')).toBe('7700900123');
        expect(normalizePhone('07700900123')).toBe('7700900123');
        expect(normalizePhone('447700900123')).toBe('7700900123');
    });
    it('returns null for empty', () => {
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
    });
});

describe('mapStage', () => {
    it('user mapping wins over heuristic', () => {
        expect(mapStage('stg_1', 'Anything', { stg_1: 'treatment_started' })).toBe('treatment_started');
    });
    it('ignores a user mapping to an invalid status, falls through', () => {
        expect(mapStage('stg_1', 'Booked', { stg_1: 'not_a_status' })).toBe('consultation_booked');
    });
    it('heuristic matches by stage name', () => {
        expect(mapStage('x', 'Consultation Booked')).toBe('consultation_booked');
        expect(mapStage('x', 'Treatment Started')).toBe('treatment_started');
        expect(mapStage('x', 'Closed Won')).toBe('treatment_started');
        expect(mapStage('x', 'No Show')).toBe('failed_to_attend');
        expect(mapStage('x', 'Lost / Dead')).toBe('not_proceeding');
    });
    it('defaults to new when unmapped + unrecognised', () => {
        expect(mapStage('x', 'Wibble')).toBe('new');
        expect(mapStage('x', undefined)).toBe('new');
    });
});

describe('extractContact', () => {
    it('reads firstName/lastName/email/phone + lowercases email', () => {
        const c = extractContact({ contact: { id: 'c1', firstName: 'John', lastName: 'Doe', email: 'JOHN@X.COM', phone: '07700900123' } });
        expect(c).toMatchObject({ ghl_contact_id: 'c1', first_name: 'John', last_name: 'Doe', email: 'john@x.com', phone: '07700900123' });
    });
    it('splits a single name field when first/last absent', () => {
        const c = extractContact({ contact: { id: 'c2', name: 'Sarah Smith' } });
        expect(c.first_name).toBe('Sarah');
        expect(c.last_name).toBe('Smith');
    });
});

// Fake query builder for matchOrCreateContact's injectable db.
function fakeDb(plan) {
    const calls = [];
    function from(table) {
        const q = { table, op: 'select', eqs: [], ilikes: [] };
        const b = {
            select() { return b; },
            insert(v) { q.op = 'insert'; q.vals = v; return b; },
            update(v) { q.op = 'update'; q.vals = v; return b; },
            upsert(v, o) { q.op = 'upsert'; q.vals = v; q.opts = o; return b; },
            delete() { q.op = 'delete'; return b; },
            eq(c, v) { q.eqs.push([c, v]); return b; },
            ilike(c, v) { q.ilikes.push([c, v]); return b; },
            limit() { return b; },
            maybeSingle() { calls.push(q); return Promise.resolve(plan(q)); },
            single() { calls.push(q); return Promise.resolve(plan(q)); },
            then(res, rej) { calls.push(q); return Promise.resolve(plan(q)).then(res, rej); },
        };
        return b;
    }
    return { from, calls };
}

describe('contactRow', () => {
    it('maps a GHL contact, lowercases email', () => {
        expect(contactRow('o', { id: 'c1', firstName: 'John', lastName: 'Doe', email: 'A@B.COM', phone: '07700900123' }))
            .toMatchObject({ organisation_id: 'o', source: 'gohighlevel', ghl_contact_id: 'c1', first_name: 'John', last_name: 'Doe', email: 'a@b.com', phone: '07700900123' });
    });
    it('splits a single name field when first/last absent', () => {
        expect(contactRow('o', { id: 'c2', name: 'Sarah Smith' })).toMatchObject({ first_name: 'Sarah', last_name: 'Smith' });
    });
});

describe('mapWebhookEventType', () => {
    it('buckets opportunity / contact events and distinguishes delete', () => {
        expect(mapWebhookEventType('OpportunityCreate')).toBe('opportunity');
        expect(mapWebhookEventType('OpportunityStatusUpdate')).toBe('opportunity');
        expect(mapWebhookEventType('OpportunityDelete')).toBe('opportunity_delete');
        expect(mapWebhookEventType('ContactUpdate')).toBe('contact');
        expect(mapWebhookEventType('ContactDelete')).toBe('contact_delete');
    });
    it('returns null for unrecognised events (ignored)', () => {
        expect(mapWebhookEventType('NoteCreate')).toBeNull();
        expect(mapWebhookEventType('')).toBeNull();
    });
});

describe('phasePct', () => {
    it('never reports a premature 100 (capped at 99)', () => {
        expect(phasePct(0, 1, 1, 1)).toBe(99);
        expect(phasePct(1, 2, 1, 1)).toBe(99);
    });
    it('splits two phases into equal bands', () => {
        expect(phasePct(0, 2, 1, 2)).toBe(25); // contacts, halfway through phase
    });
    it('soft-ramps (never frozen at 0) when total is unknown', () => {
        expect(phasePct(0, 1, 1, null)).toBe(50);
        expect(phasePct(0, 1, 3, null)).toBe(75);
    });
});

describe('upsertOpportunity', () => {
    it('matches the contact then upserts a lead with the idempotent conflict target', async () => {
        const db = fakeDb((q) => {
            if (q.table === 'contacts' && q.op === 'select') return { data: { id: 'c-existing' }, error: null };
            if (q.table === 'leads' && q.op === 'upsert') return { error: null };
            return { data: null, error: null };
        });
        const r = await upsertOpportunity('org-1', { id: 'opp1', name: 'Implant', monetaryValue: 1200, pipelineStageId: 's1', stageName: 'Consultation Booked', contact: { id: 'g1' } }, null, {}, db);
        expect(r).toEqual({ ok: true });
        const lead = db.calls.find((c) => c.table === 'leads' && c.op === 'upsert');
        expect(lead.opts).toMatchObject({ onConflict: 'organisation_id,ghl_opportunity_id' });
        expect(lead.vals).toMatchObject({
            ghl_opportunity_id: 'opp1', estimated_value_pence: 120000,
            status: 'consultation_booked', sync_status: 'synced',
            source: 'gohighlevel', contact_id: 'c-existing',
        });
    });
    it('skips an opportunity with no id', async () => {
        const r = await upsertOpportunity('o', {}, {}, fakeDb(() => ({})));
        expect(r).toMatchObject({ skipped: 'no_opportunity_id' });
    });
});

describe('applyWebhookEvent (routing guards)', () => {
    it('ignores unknown event type and missing record id without touching the DB', async () => {
        expect(await applyWebhookEvent('o', null, { id: 1 })).toEqual({ ignored: 'unknown_event' });
        expect(await applyWebhookEvent('o', 'contact', {})).toEqual({ ignored: 'no_record_id' });
    });
});

describe('matchOrCreateContact', () => {
    const org = 'org-1';

    it('matches by ghl_contact_id first (no insert)', async () => {
        const db = fakeDb((q) => {
            if (q.op === 'select' && q.eqs.some(([c]) => c === 'ghl_contact_id')) return { data: { id: 'existing' }, error: null };
            return { data: null, error: null };
        });
        const id = await matchOrCreateContact(org, { ghl_contact_id: 'g1', email: 'a@b.com' }, null, db);
        expect(id).toBe('existing');
        expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
    });

    it('falls back to email (case-insensitive) and backfills ghl_contact_id', async () => {
        const db = fakeDb((q) => {
            if (q.eqs.some(([c]) => c === 'ghl_contact_id') && q.op === 'select') return { data: null, error: null };
            if (q.ilikes.some(([c]) => c === 'email')) return { data: { id: 'by-email' }, error: null };
            return { data: null, error: null };
        });
        const id = await matchOrCreateContact(org, { ghl_contact_id: 'g1', email: 'A@B.com' }, null, db);
        expect(id).toBe('by-email');
        expect(db.calls.some((c) => c.op === 'update')).toBe(true); // backfilled ghl id
    });

    it('creates a new contact when nothing matches (upsert on ghl_contact_id, race-proof)', async () => {
        const db = fakeDb((q) => {
            if (q.op === 'upsert') return { data: { id: 'new-contact' }, error: null };
            return { data: null, error: null };
        });
        const id = await matchOrCreateContact(org, { ghl_contact_id: 'g9', email: 'new@x.com', phone: '07700900999', first_name: 'New' }, null, db);
        expect(id).toBe('new-contact');
        const up = db.calls.find((c) => c.op === 'upsert');
        expect(up.opts).toMatchObject({ onConflict: 'organisation_id,ghl_contact_id' });
        expect(up.vals).toMatchObject({ organisation_id: org, source: 'gohighlevel', ghl_contact_id: 'g9' });
    });
});

describe('upsertContact (dedup on pull)', () => {
    const org = 'org-1';

    it('links an existing contact matched by email instead of inserting a duplicate', async () => {
        const db = fakeDb((q) => {
            if (q.table === 'contacts' && q.eqs.some(([c]) => c === 'ghl_contact_id') && q.op === 'select') return { data: null, error: null };
            if (q.ilikes.some(([c]) => c === 'email')) return { data: { id: 'existing-dentally' }, error: null };
            return { data: null, error: null };
        });
        const r = await upsertContact(org, contactRow(org, { id: 'g1', firstName: 'Ruhith', email: 'A@B.com' }), db);
        expect(r).toEqual({ id: 'existing-dentally', action: 'merge_email' });
        // links the ghl id, does NOT insert a second row or clobber source
        const update = db.calls.find((c) => c.op === 'update');
        expect(update.vals).toEqual({ ghl_contact_id: 'g1' });
        expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
    });

    it('updates in place when the ghl_contact_id already exists', async () => {
        const db = fakeDb((q) => {
            if (q.eqs.some(([c]) => c === 'ghl_contact_id') && q.op === 'select') return { data: { id: 'same-ghl' }, error: null };
            return { data: null, error: null };
        });
        const r = await upsertContact(org, contactRow(org, { id: 'g1', firstName: 'Ruhith', email: 'a@b.com' }), db);
        expect(r).toMatchObject({ id: 'same-ghl', action: 'update' });
        expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
    });

    // Found live on Plan4growth: a contact matched to a real Dentally patient
    // (pms_external_id set) was having its phone/name silently overwritten by
    // EVERY subsequent GoHighLevel contact pull — 2,996 GHL-linked patients on
    // that one org, all subject to it. Dentally is the authoritative source
    // for a confirmed patient's identity; this refresh must not touch it,
    // same "never clobber" rule the email/phone-match branches already apply
    // on first link.
    it('does NOT overwrite phone/name/email when the matched contact is a confirmed Dentally patient', async () => {
        const db = fakeDb((q) => {
            if (q.eqs.some(([c]) => c === 'ghl_contact_id') && q.op === 'select') {
                return { data: { id: 'patient-row', pms_external_id: '28674' }, error: null };
            }
            return { data: null, error: null };
        });
        const r = await upsertContact(
            org,
            contactRow(org, { id: 'g1', firstName: 'Julie', lastName: 'Wells', email: 'julie@x.com', phone: '07986228421' }),
            db,
        );
        expect(r).toEqual({ id: 'patient-row', action: 'update_patient_identity_locked' });
        const update = db.calls.find((c) => c.op === 'update');
        expect(update.vals).not.toHaveProperty('phone');
        expect(update.vals).not.toHaveProperty('first_name');
        expect(update.vals).not.toHaveProperty('last_name');
        expect(update.vals).not.toHaveProperty('email');
    });

    // The un-linked case (no pms_external_id — a bare GHL lead, never matched
    // to a Dentally patient) keeps refreshing normally: GoHighLevel IS the
    // authoritative source for someone who is not (yet, or ever) a patient.
    it('still refreshes phone/name/email for a GHL contact with no Dentally link', async () => {
        const db = fakeDb((q) => {
            if (q.eqs.some(([c]) => c === 'ghl_contact_id') && q.op === 'select') {
                return { data: { id: 'lead-only', pms_external_id: null }, error: null };
            }
            return { data: null, error: null };
        });
        const r = await upsertContact(
            org,
            contactRow(org, { id: 'g2', firstName: 'New', lastName: 'Lead', email: 'new@x.com', phone: '07700900000' }),
            db,
        );
        expect(r).toEqual({ id: 'lead-only', action: 'update' });
        const update = db.calls.find((c) => c.op === 'update');
        expect(update.vals).toMatchObject({ first_name: 'New', last_name: 'Lead', email: 'new@x.com', phone: '07700900000' });
    });

    it('creates a new contact when nothing matches (upsert on ghl_contact_id, race-proof)', async () => {
        const db = fakeDb(() => ({ data: null, error: null }));
        const r = await upsertContact(org, contactRow(org, { id: 'g9', firstName: 'New', email: 'new@x.com', phone: '07700900999' }), db);
        expect(r).toMatchObject({ action: 'insert' });
        const up = db.calls.find((c) => c.op === 'upsert');
        expect(up.opts).toMatchObject({ onConflict: 'organisation_id,ghl_contact_id' });
        expect(up.vals).toMatchObject({ organisation_id: org, source: 'gohighlevel', ghl_contact_id: 'g9' });
    });
});

// ============================================================================
// The contact book is walked WHOLE, or it is not synced.
//
// pullContacts took the routine page cap — 50 pages x 100 = 5,000 contacts —
// and three of this org's four GoHighLevel locations are past it: 9,832 / 8,057
// / 7,311 contacts against a walk that stopped at 5,000. Everything beyond that
// point was never looked at again after the on-connect bootstrap, so an edit or
// an addition out there simply never arrived.
//
// The cap made no sense for THIS endpoint in particular. GHL's /contacts/ list
// cannot filter server-side — the code says so a few lines below — so the walk
// is full-length whatever happens; the incremental saving is in the WRITE,
// which `selectContactsToWrite` already does. Capping the read bought nothing
// and cost the tail of the book.
// ============================================================================
describe('pullContacts walks the whole contact book', () => {
    it('does not stop at the routine page cap the other resources use', async () => {
        const { CONTACT_MAX_PAGES, MAX_PAGES } = await import('../src/lib/integrations/gohighlevel-sync.js');
        // Whatever the routine cap is for the resources GHL CAN filter, the
        // contact walk must reach further — a location with 9,832 contacts
        // needs 99 pages.
        expect(CONTACT_MAX_PAGES).toBeGreaterThanOrEqual(500);
        expect(CONTACT_MAX_PAGES).toBeGreaterThan(MAX_PAGES);
    });
});

// ============================================================================
// A contact who exists in TWO GoHighLevel locations.
//
// The dedup maps are org-wide, so the same person in Ashford and Barnet is one
// contacts row — deliberately, and that part stays. What did not: the link step
// also overwrote integration_account_id, so whichever location synced last
// claimed the row and the other location's contact count silently dropped by
// one. Measured on live data, 552 email addresses and 687 phone numbers appear
// in more than one location.
// ============================================================================
describe('linkAccountPatch — a shared contact keeps the location that found it first', () => {
    it('claims a contact that belongs to no account yet', async () => {
        const { linkAccountPatch } = await import('../src/lib/integrations/gohighlevel-sync.js');
        expect(linkAccountPatch('acct-ashford', null)).toEqual({ integration_account_id: 'acct-ashford' });
    });

    it('leaves a contact already attributed to another location alone', async () => {
        const { linkAccountPatch } = await import('../src/lib/integrations/gohighlevel-sync.js');
        // Barnet finds a contact Ashford already owns. Linking the GHL id is
        // right; moving the row is not — it would take one off Ashford's count
        // every night and put it back the next time the order changed.
        expect(linkAccountPatch('acct-barnet', 'acct-ashford')).toEqual({});
    });

    it('is a no-op when there is no account to attribute to', async () => {
        const { linkAccountPatch } = await import('../src/lib/integrations/gohighlevel-sync.js');
        expect(linkAccountPatch(null, null)).toEqual({});
    });
});
