// ============================================================================
// Sheet-export routes — owner-only "GHL→Dentally conversion export" endpoints
// mounted under /api/integrations/google-sheets-writer/*. Verifies role
// gating (owner full access, practice_manager read-only status, reception
// locked out entirely), the 400 on a junk destination URL, and that no
// response body ever leaks a `secrets` field.
// ============================================================================
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { AppError } from '../src/middleware/errors.js';

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
    req.user = role ? { id: 'u1', organisation_id: 'org-1', role } : null;
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

async function call(method, path, { role, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(role ? { 'x-test-role': role } : {}),
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

  it('practice_manager gets status + activity 200 but 403 on destination/drain/delete', async () => {
    for (const path of READ_PATHS) {
      const { status } = await call('GET', path, { role: 'practice_manager' });
      expect(status, `GET ${path}`).toBe(200);
    }

    for (const ep of ENDPOINTS.filter((e) => !READ_PATHS.includes(e.path))) {
      const { status: code } = await call(ep.method, ep.path, { role: 'practice_manager', body: ep.body });
      expect(code, `${ep.method} ${ep.path}`).toBe(403);
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
