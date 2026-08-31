// Marketing route wiring: the permission key exists, the feature key exists,
// and Reception can never reach it (project rule 5 — Reception is CRM-only).
import { describe, it, expect } from 'vitest';
const { PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS } = await import('../src/lib/permissions.js');
const { FEATURE_CATALOG } = await import('../src/lib/features.js');

describe('marketing gating', () => {
    it('registers a marketing.view permission', () => {
        expect(PERMISSION_CATALOG).toHaveProperty('marketing.view');
    });
    it('registers a marketing module feature defaulting ON with its nav section', () => {
        expect(FEATURE_CATALOG.marketing).toMatchObject({
            kind: 'module', default: true, navSection: 'Marketing',
        });
    });
    it('grants marketing.view to practice_manager but NEVER to reception', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['marketing.view']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.reception['marketing.view']).toBeUndefined();
    });
    it('owner keeps everything, marketing included', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.owner['marketing.view']).toBe(true);
    });
});
