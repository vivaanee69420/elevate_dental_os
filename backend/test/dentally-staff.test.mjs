import { describe, it, expect } from 'vitest';
import { staffRow, mapDentallyRole } from '../src/lib/integrations/dentally-sync.js';

const ORG = 'org-dddddddd';
const siteMap = new Map([['site-1', 'practice-uuid-1']]);

describe('mapDentallyRole', () => {
    it('buckets free-text Dentally roles into the staff enum', () => {
        expect(mapDentallyRole('Receptionist')).toBe('reception');
        expect(mapDentallyRole('Dental Nurse')).toBe('nurse');
        expect(mapDentallyRole('Hygienist')).toBe('hygienist');
        expect(mapDentallyRole('Therapist')).toBe('therapist');
        expect(mapDentallyRole('Treatment Coordinator')).toBe('tco');
        expect(mapDentallyRole('Practice Manager')).toBe('manager');
        // Clinical / unknown roles fall through to the catch-all bucket.
        expect(mapDentallyRole('Dentist')).toBe('other');
        expect(mapDentallyRole(null)).toBe('other');
    });
});

describe('staffRow', () => {
    it('maps a Dentally user to a staff row, resolving the practice via siteMap', () => {
        const row = staffRow(ORG, {
            id: 266753, title: 'Dr', first_name: 'Gaurav', last_name: 'Mehta',
            email: 'g@x.com', mobile_phone: '07900', role: 'Dentist',
            site_id: 'site-1', last_login: '2026-05-20T10:00:00Z',
        }, siteMap);
        expect(row).toMatchObject({
            organisation_id: ORG,
            source: 'dentally',
            pms_external_id: '266753',
            full_name: 'Dr Gaurav Mehta',
            role: 'other',           // enum bucket
            pms_role: 'Dentist',     // raw label preserved
            email: 'g@x.com',
            phone: '07900',
            title: 'Dr',
            last_login_at: '2026-05-20T10:00:00Z',
            practice_id: 'practice-uuid-1',
            active: true,
        });
    });

    it('falls back to a synthetic name and null practice when fields/site are missing', () => {
        const row = staffRow(ORG, { id: 9, role: 'Receptionist', site_id: 'unknown' }, siteMap);
        expect(row.full_name).toBe('User 9');
        expect(row.role).toBe('reception');
        expect(row.practice_id).toBeNull();
        expect(row.email).toBeNull();
    });
});
