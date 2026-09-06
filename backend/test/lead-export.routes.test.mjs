// ============================================================================
// GET /api/leads/export.csv — the permission gate.
//
// Every other route on this router is open to any authenticated org member
// (crm.view is a UI-only nav gate today). The export route is deliberately
// stricter: it is gated on `requirePermission('data.export')`, the SAME key
// the Data Room uses, NOT `crm.view` — taking patient-identifying leads off
// the board is a bigger act than viewing them. That means reception and a
// practice manager (both hold crm.view, neither holds data.export) can see
// the Pipeline board but cannot export it — exactly rule 5's intent.
// ============================================================================
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';

vi.mock('../src/services/lead.service.js', () => ({
  leadService: {
    list: vi.fn(async () => []),
    funnel: vi.fn(async () => ({})),
    report: vi.fn(async () => ({})),
    pipelines: vi.fn(async () => ({ pipelines: [] })),
    getById: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    softDelete: vi.fn(async () => ({ success: true })),
    exportFilename: vi.fn(() => 'pipeline-leads_pipe-1_2026-09-06.csv'),
    streamExportCsv: vi.fn(async (orgId, q, sink) => {
      sink.write('id\r\n');
      sink.write('lead-1\r\n');
      sink.end();
      return { rows: 1 };
    }),
  },
}));

const { default: router } = await import('../src/routes/leads.routes.js');
const { errorHandler, AppError } = await import('../src/middleware/errors.js');
const { leadService } = await import('../src/services/lead.service.js');

// Mirrors what authenticate() resolves onto req.user in production — role +
// the admin-configured effective permissions map.
const PERMS = {
  owner: { 'data.export': true, 'crm.view': true },
  analyst: { 'data.export': true }, // Data Room's role — holds the same key
  practice_manager: { 'crm.view': true, 'crm.manage': true }, // no data.export
  reception: { 'crm.view': true }, // no data.export
};

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    req.user = role ? { id: `u-${role}`, organisation_id: 'org-1', role, permissions: PERMS[role] } : null;
    next();
  });
  app.use('/api/leads', router);
  app.use(errorHandler);
  return app;
}

let server; let baseUrl;
beforeAll(async () => {
  server = http.createServer(buildApp());
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => vi.clearAllMocks());

const get = (path, role) => fetch(`${baseUrl}${path}`, { headers: role ? { 'x-test-role': role } : {} });

describe('GET /api/leads/export.csv — gate', () => {
  it('owner and analyst (hold data.export) can export', async () => {
    for (const role of ['owner', 'analyst']) {
      const res = await get('/api/leads/export.csv', role);
      expect(res.status).toBe(200);
    }
  });

  it('practice_manager and reception (crm.view only — no data.export) are refused', async () => {
    for (const role of ['practice_manager', 'reception']) {
      const res = await get('/api/leads/export.csv', role);
      expect(res.status).toBe(403);
      expect(leadService.streamExportCsv).not.toHaveBeenCalled();
    }
  });

  it('an unauthenticated caller is refused', async () => {
    expect((await get('/api/leads/export.csv')).status).toBe(403);
  });

  it('is registered before the /:id route so it is never swallowed as an id', async () => {
    const res = await get('/api/leads/export.csv', 'owner');
    expect(res.status).toBe(200);
    expect(leadService.getById).not.toHaveBeenCalled();
    expect(leadService.streamExportCsv).toHaveBeenCalledTimes(1);
    expect(leadService.streamExportCsv.mock.calls[0][0]).toBe('org-1'); // orgId only from req.user
  });
});

describe('GET /api/leads/export.csv — response shape', () => {
  it('streams text/csv with a download filename and no-store', async () => {
    const res = await get('/api/leads/export.csv?ghl_pipeline_id=pipe-1', 'owner');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="pipeline-leads_pipe-1_2026-09-06.csv"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('id\r\nlead-1\r\n');
  });

  it('a service error before the first byte maps to a JSON status, not a stream', async () => {
    leadService.streamExportCsv.mockRejectedValueOnce(new AppError('boom', 500));
    const res = await get('/api/leads/export.csv', 'owner');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });
});
