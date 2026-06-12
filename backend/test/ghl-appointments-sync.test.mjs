// Tests for GHL appointments sync pure helpers: mapAppointmentStatus + appointmentRow.
// Import via dynamic import so ESM module cache loads the real source.
import { describe, it, expect } from 'vitest';

const { mapAppointmentStatus, appointmentRow } = await import('../src/lib/integrations/gohighlevel-sync.js');

// ---------------------------------------------------------------------------
// mapAppointmentStatus
// ---------------------------------------------------------------------------
describe('mapAppointmentStatus', () => {
    it('maps showed', () => expect(mapAppointmentStatus('showed')).toBe('showed'));
    it('maps showed with extra whitespace', () => expect(mapAppointmentStatus('  Showed  ')).toBe('showed'));

    it('maps noshow', () => expect(mapAppointmentStatus('noshow')).toBe('noshow'));
    it('maps no-show', () => expect(mapAppointmentStatus('no-show')).toBe('noshow'));
    it('maps no_show', () => expect(mapAppointmentStatus('no_show')).toBe('noshow'));
    it('maps NO_SHOW uppercased', () => expect(mapAppointmentStatus('NO_SHOW')).toBe('noshow'));

    it('maps cancelled', () => expect(mapAppointmentStatus('cancelled')).toBe('cancelled'));
    it('maps canceled (US spelling)', () => expect(mapAppointmentStatus('canceled')).toBe('cancelled'));
    it('maps CANCELLED uppercased', () => expect(mapAppointmentStatus('CANCELLED')).toBe('cancelled'));

    it('maps confirmed', () => expect(mapAppointmentStatus('confirmed')).toBe('confirmed'));

    it('maps new', () => expect(mapAppointmentStatus('new')).toBe('booked'));
    it('maps booked', () => expect(mapAppointmentStatus('booked')).toBe('booked'));

    it('maps invalid', () => expect(mapAppointmentStatus('invalid')).toBe('invalid'));

    it('defaults unknown status to booked', () => expect(mapAppointmentStatus('whatever')).toBe('booked'));
    it('defaults null to booked', () => expect(mapAppointmentStatus(null)).toBe('booked'));
    it('defaults undefined to booked', () => expect(mapAppointmentStatus(undefined)).toBe('booked'));
    it('defaults empty string to booked', () => expect(mapAppointmentStatus('')).toBe('booked'));
});

// ---------------------------------------------------------------------------
// appointmentRow
// ---------------------------------------------------------------------------
describe('appointmentRow', () => {
    const org = 'org-abc';
    const account = { id: 'acct-1', practice_id: 'prac-1' };
    const contactMap = new Map([['c999', 'internal-contact-1']]);

    it('maps a full event with contact lookup hit', () => {
        const event = {
            id: 'evt-1',
            calendarId: 'cal-1',
            title: 'Consultation',
            appointmentStatus: 'confirmed',
            startTime: '2026-06-15T10:00:00.000Z',
            endTime: '2026-06-15T10:30:00.000Z',
            contactId: 'c999',
        };
        const row = appointmentRow(org, account, event, 'My Calendar', contactMap);
        expect(row.organisation_id).toBe('org-abc');
        expect(row.integration_account_id).toBe('acct-1');
        expect(row.practice_id).toBe('prac-1');
        expect(row.contact_id).toBe('internal-contact-1');
        expect(row.ghl_event_id).toBe('evt-1');
        expect(row.ghl_calendar_id).toBe('cal-1');
        expect(row.calendar_name).toBe('My Calendar');
        expect(row.title).toBe('Consultation');
        expect(row.status).toBe('confirmed');
        expect(row.starts_at).toBe('2026-06-15T10:00:00.000Z');
        expect(row.ends_at).toBe('2026-06-15T10:30:00.000Z');
    });

    it('maps contact_id as null on contact lookup miss', () => {
        const event = { id: 'evt-2', appointmentStatus: 'new', contactId: 'unknown-contact' };
        const row = appointmentRow(org, account, event, null, contactMap);
        expect(row.contact_id).toBeNull();
    });

    it('maps contact_id as null when contactId absent', () => {
        const event = { id: 'evt-3', appointmentStatus: 'showed' };
        const row = appointmentRow(org, account, event, 'Cal', contactMap);
        expect(row.contact_id).toBeNull();
    });

    it('handles null contactMap gracefully', () => {
        const event = { id: 'evt-4', contactId: 'c999', appointmentStatus: 'booked' };
        const row = appointmentRow(org, account, event, null, null);
        expect(row.contact_id).toBeNull();
    });

    it('sets calendar_name to null when not provided', () => {
        const event = { id: 'evt-5', appointmentStatus: 'confirmed' };
        const row = appointmentRow(org, account, event, null, null);
        expect(row.calendar_name).toBeNull();
        expect(row.ghl_calendar_id).toBeNull();
    });

    it('handles ISO startTime and endTime', () => {
        const event = {
            id: 'evt-6',
            appointmentStatus: 'showed',
            startTime: '2026-06-15T09:00:00.000Z',
            endTime: '2026-06-15T09:30:00.000Z',
        };
        const row = appointmentRow(org, account, event, null, null);
        expect(row.starts_at).toBe('2026-06-15T09:00:00.000Z');
        expect(row.ends_at).toBe('2026-06-15T09:30:00.000Z');
    });

    it('handles epoch-ms startTime as a numeric string', () => {
        const ms = 1750000000000; // a valid epoch ms
        const event = {
            id: 'evt-7',
            appointmentStatus: 'booked',
            startTime: String(ms),
            endTime: String(ms + 1800000),
        };
        const row = appointmentRow(org, account, event, null, null);
        expect(row.starts_at).toBe(new Date(ms).toISOString());
        expect(row.ends_at).toBe(new Date(ms + 1800000).toISOString());
    });

    it('sets starts_at and ends_at to null when dates are missing', () => {
        const event = { id: 'evt-8', appointmentStatus: 'confirmed' };
        const row = appointmentRow(org, account, event, null, null);
        expect(row.starts_at).toBeNull();
        expect(row.ends_at).toBeNull();
    });

    it('sets starts_at to null for an invalid date string', () => {
        const event = { id: 'evt-9', appointmentStatus: 'confirmed', startTime: 'not-a-date' };
        const row = appointmentRow(org, account, event, null, null);
        expect(row.starts_at).toBeNull();
    });

    it('uses null practice_id when account has none', () => {
        const accountNoPractice = { id: 'acct-2', practice_id: null };
        const event = { id: 'evt-10', appointmentStatus: 'confirmed' };
        const row = appointmentRow(org, accountNoPractice, event, null, null);
        expect(row.practice_id).toBeNull();
    });

    it('casts ghl_event_id and ghl_calendar_id to strings', () => {
        const event = { id: 12345, calendarId: 67890, appointmentStatus: 'new' };
        const row = appointmentRow(org, account, event, null, null);
        expect(row.ghl_event_id).toBe('12345');
        expect(row.ghl_calendar_id).toBe('67890');
    });
});
