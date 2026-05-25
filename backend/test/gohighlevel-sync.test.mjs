// GoHighLevel sync — pure mapping helpers + contact match/create priority.
import { describe, it, expect } from 'vitest';
import {
    toPence, normalizePhone, mapStage, extractContact, matchOrCreateContact,
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

describe('matchOrCreateContact', () => {
    const org = 'org-1';

    it('matches by ghl_contact_id first (no insert)', async () => {
        const db = fakeDb((q) => {
            if (q.op === 'select' && q.eqs.some(([c]) => c === 'ghl_contact_id')) return { data: { id: 'existing' }, error: null };
            return { data: null, error: null };
        });
        const id = await matchOrCreateContact(org, { ghl_contact_id: 'g1', email: 'a@b.com' }, db);
        expect(id).toBe('existing');
        expect(db.calls.some((c) => c.op === 'insert')).toBe(false);
    });

    it('falls back to email (case-insensitive) and backfills ghl_contact_id', async () => {
        const db = fakeDb((q) => {
            if (q.eqs.some(([c]) => c === 'ghl_contact_id') && q.op === 'select') return { data: null, error: null };
            if (q.ilikes.some(([c]) => c === 'email')) return { data: { id: 'by-email' }, error: null };
            return { data: null, error: null };
        });
        const id = await matchOrCreateContact(org, { ghl_contact_id: 'g1', email: 'A@B.com' }, db);
        expect(id).toBe('by-email');
        expect(db.calls.some((c) => c.op === 'update')).toBe(true); // backfilled ghl id
    });

    it('creates a new contact when nothing matches', async () => {
        const db = fakeDb((q) => {
            if (q.op === 'insert') return { data: { id: 'new-contact' }, error: null };
            return { data: null, error: null };
        });
        const id = await matchOrCreateContact(org, { ghl_contact_id: 'g9', email: 'new@x.com', phone: '07700900999', first_name: 'New' }, db);
        expect(id).toBe('new-contact');
        const insert = db.calls.find((c) => c.op === 'insert');
        expect(insert.vals).toMatchObject({ organisation_id: org, source: 'gohighlevel', ghl_contact_id: 'g9' });
    });
});
