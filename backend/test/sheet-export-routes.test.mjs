// ============================================================================
// Sheet-export routes — owner-only "GHL→Dentally conversion export" endpoints
// mounted under /api/integrations/google-sheets-writer/*. Verifies role
// gating (owner full access, practice_manager read-only status, reception
// locked out entirely), the 400 on a junk destination URL, and that no
// response body ever leaks a `secrets` field.
// ============================================================================
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { defaultPermissionsForRole } from '../src/lib/permissions.js';
import http from 'node:http';
import express from 'express';
import { AppError } from '../src/middleware/errors.js';

// google-sheets-writer/* routes now carry a per-route requireFeature
// ('sheet_export') gate ahead of the role gate under test here — stub the
// org as entitled so these role-gating assertions stay isolated from
// feature-flag resolution (covered separately in
// features.middleware.test.mjs / features.route-gates.test.mjs).
vi.mock('../src/services/features.service.js', () => ({
  featuresService: { orgHasFeature: vi.fn(async () => true) },
}));

vi.mock('../src/services/sheet-export.service.js', () => ({
  sheetExportService: {
    status: vi.fn(async () => ({
      connected: true,
      status: 'active',
      spreadsheetId: 'sheet-123',
      exportSince: '2026-01-01T00:00:00.000Z',
      lastError: null,
      counts: { pending: 0, exported: 5, no_match: 1, failed: 0 },
    })),
    setDestination: vi.fn(async (orgId, url) => {
      if (!url.includes('docs.google.com')) {
        // Mirrors the real sheetExportService.setDestination shape (Task 7 as
        // fixed in review): AppError, not a plain Error+status.
        throw new AppError('Not a valid Google Sheets URL', 400);
      }
      return { spreadsheetId: 'sheet-123', exportSince: '2026-01-01T00:00:00.000Z' };
    }),
    drainOrg: vi.fn(async () => ({ processed: 3, exported: 2, no_match: 1, failed: 0 })),
    disconnect: vi.fn(async () => ({ disconnected: true })),
    activity: vi.fn(async () => ({ entries: [] })),
    refreshOrg: vi.fn(async () => ({ refreshed: 0 })),
  },
}));

const { default: router } = await import('../src/routes/integrations.routes.js');
const { errorHandler } = await import('../src/middleware/errors.js');
const { sheetExportService } = await import('../src/services/sheet-export.service.js');

// Minimal real app: a stub auth middleware (reads role off a test header),
// the actual router under test, and the app's real error handler — so a
// service throw exercises the same mapping production requests get.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    // Production never hands a route a bare role: `authenticate` always
    // resolves the permission map, and the gates read THAT. Building a
    // user without one made these tests answer a question no real
    // request asks, and they failed the moment the gates stopped
    // consulting the role directly.
    req.user = role
      ? {
        id: 'u1',
        organisation_id: 'org-1',
        role,
        // Role defaults plus whatever the owner has ticked for this person —
        // exactly the two layers resolveEffectivePermissions merges.
        permissions: {
          ...defaultPermissionsForRole(role),
          ...JSON.parse(req.headers['x-test-grant'] ?? '{}'),
        },
      }
      : null;
    next();
  });
  app.use('/api/integrations', router);
  app.use(errorHandler);
  return app;
}

let server;
let baseUrl;

beforeAll(async () => {
  server = http.createServer(buildApp());
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, { role, body, grant } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(role ? { 'x-test-role': role } : {}),
      ...(grant ? { 'x-test-grant': JSON.stringify(grant) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// status + activity are owner+PM reads; the rest are owner-only mutations.
const READ_PATHS = [
  '/api/integrations/google-sheets-writer/status',
  '/api/integrations/google-sheets-writer/activity',
];
const ENDPOINTS = [
  { method: 'GET', path: '/api/integrations/google-sheets-writer/status' },
  { method: 'GET', path: '/api/integrations/google-sheets-writer/activity' },
  { method: 'POST', path: '/api/integrations/google-sheets-writer/destination', body: { url: 'https://docs.google.com/spreadsheets/d/abc123/edit' } },
  { method: 'POST', path: '/api/integrations/google-sheets-writer/drain' },
  { method: 'DELETE', path: '/api/integrations/google-sheets-writer' },
];

describe('sheet-export routes — role gating', () => {
  it('owner can hit all endpoints (200)', async () => {
    for (const ep of ENDPOINTS) {
      const { status } = await call(ep.method, ep.path, { role: 'owner', body: ep.body });
      expect(status, `${ep.method} ${ep.path}`).toBe(200);
    }
  });

  // CONTRACT CHANGE, stated rather than absorbed. These endpoints used to
  // admit a practice manager by ROLE, on every verb this test lists as read.
  // They are now gated on system.manage, which a practice manager does not
  // hold by default — the same key the Integrations nav item uses, and this
  // panel lives inside that dialog, so a practice manager had API access to a
  // screen they could not navigate to. Aligning the two is the point of the
  // change, not a side effect of it.
  //
  // What they LOSE is access nobody could reach through the product. What they
  // GAIN is that an owner can now grant it deliberately — before, the role
  // list was the ceiling and no amount of ticking could move it.
  it('practice_manager is 403 without system.manage, and 200 the moment it is granted', async () => {
    for (const ep of ENDPOINTS) {
      const { status } = await call(ep.method, ep.path, { role: 'practice_manager', body: ep.body });
      expect(status, `${ep.method} ${ep.path}`).toBe(403);
    }

    // The grant is the whole feature: a permission the owner ticks, honoured.
    for (const ep of ENDPOINTS) {
      const { status } = await call(ep.method, ep.path, {
        role: 'practice_manager', body: ep.body, grant: { 'system.manage': true },
      });
      expect(status, `${ep.method} ${ep.path} (granted)`).toBe(200);
    }
  });

  it('reception is 403 on all endpoints', async () => {
    for (const ep of ENDPOINTS) {
      const { status } = await call(ep.method, ep.path, { role: 'reception', body: ep.body });
      expect(status, `${ep.method} ${ep.path}`).toBe(403);
    }
  });

  it('unauthenticated is 403 on all endpoints', async () => {
    for (const ep of ENDPOINTS) {
      const { status } = await call(ep.method, ep.path, { body: ep.body });
      expect(status, `${ep.method} ${ep.path}`).toBe(403);
    }
  });
});

describe('sheet-export routes — destination validation', () => {
  it('a junk URL 400s with the service message', async () => {
    const { status, json } = await call('POST', '/api/integrations/google-sheets-writer/destination', {
      role: 'owner',
      body: { url: 'not-a-sheet-url' },
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/valid Google Sheets URL/i);
  });

  it('a missing url is a Zod 400', async () => {
    const { status } = await call('POST', '/api/integrations/google-sheets-writer/destination', {
      role: 'owner',
      body: {},
    });
    expect(status).toBe(400);
  });
});

describe('sheet-export routes — no secrets leak', () => {
  it('status/drain/disconnect bodies never contain a secrets field', async () => {
    for (const ep of ENDPOINTS) {
      const { json } = await call(ep.method, ep.path, { role: 'owner', body: ep.body });
      expect(json).not.toHaveProperty('secrets');
      expect(JSON.stringify(json)).not.toMatch(/"secrets"/);
    }
  });
});

describe('sheet-export routes — service wiring sanity', () => {
  it('drain calls drainOrg with includeNoMatch + ignoreBackoff (manual re-check is immediate)', async () => {
    await call('POST', '/api/integrations/google-sheets-writer/drain', { role: 'owner' });
    expect(sheetExportService.drainOrg).toHaveBeenCalledWith('org-1', { includeNoMatch: true, ignoreBackoff: true });
  });
});
