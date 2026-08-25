// backend/test/data-room-routes.test.mjs
// ============================================================================
// Data Room routes — gate is requirePermission('data.export'); analyst and
// owner pass, reception/PM (no key) are 403. CSV export sets the download
// headers and streams; JSON page shapes pass through; service errors map via
// the real errorHandler.
// ============================================================================
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import { AppError } from '../src/middleware/errors.js';

vi.mock('../src/services/data-room.service.js', () => ({
  dataRoomService: {
    datasets: vi.fn(() => ({ sources: [{ key: 'dentally', label: 'Dentally', description: '', datasets: [] }] })),
    page: vi.fn(async (user, source, dataset) => {
      if (dataset === 'nope') throw new AppError('Unknown dataset', 404);
      return { rows: [{ id: 'r1' }], next_cursor: null, total: 1 };
    }),
    exportFilename: vi.fn(() => 'dentally-appointments_2026-08-01_2026-08-31.csv'),
    streamCsv: vi.fn(async (user, source, dataset, query, sink) => {
      sink.write('﻿id\r\n');
      sink.write('r1\r\n');
      sink.end();
      return { rows: 1 };
    }),
  },
}));

const { default: router } = await import('../src/routes/data-room.routes.js');
const { errorHandler } = await import('../src/middleware/errors.js');
const { dataRoomService } = await import('../src/services/data-room.service.js');

// Stub auth: role + effective permissions come from test headers, mirroring
// what authenticate() would resolve (analyst -> data.export only).
const PERMS = {
  owner: { 'data.export': true, 'finance.view': true },
  analyst: { 'data.export': true },
  practice_manager: { 'operations.view': true },
  reception: { 'crm.view': true },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    req.user = role ? { id: `u-${role}`, organisation_id: 'org-1', role, permissions: PERMS[role] } : null;
    next();
  });
  app.use('/api/data-room', router);
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
beforeEach(() => { vi.clearAllMocks(); });

const get = (path, role) => fetch(`${baseUrl}${path}`, { headers: role ? { 'x-test-role': role } : {} });
const WIN = 'since=2026-08-01T00:00:00.000Z&until=2026-09-01T00:00:00.000Z';

describe('gate', () => {
  it('analyst and owner can list datasets; reception/PM/anon cannot', async () => {
    expect((await get('/api/data-room/datasets', 'analyst')).status).toBe(200);
    expect((await get('/api/data-room/datasets', 'owner')).status).toBe(200);
    expect((await get('/api/data-room/datasets', 'reception')).status).toBe(403);
    expect((await get('/api/data-room/datasets', 'practice_manager')).status).toBe(403);
    expect((await get('/api/data-room/datasets')).status).toBe(403);
  });
  it('reception is locked out of page and export too', async () => {
    expect((await get(`/api/data-room/dentally/appointments?${WIN}`, 'reception')).status).toBe(403);
    expect((await get(`/api/data-room/dentally/appointments/export.csv?${WIN}`, 'reception')).status).toBe(403);
  });
});

describe('GET /:source/:dataset', () => {
  it('parses query and returns the page', async () => {
    const res = await get(`/api/data-room/dentally/appointments?${WIN}&limit=50&scope=all`, 'analyst');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [{ id: 'r1' }], next_cursor: null, total: 1 });
    const [user, source, dataset, query] = dataRoomService.page.mock.calls[0];
    expect(user.role).toBe('analyst');
    expect(source).toBe('dentally');
    expect(dataset).toBe('appointments');
    expect(query).toMatchObject({ scope: 'all', limit: 50, pii: false });
  });
  it('400s on a bad query (limit=0) and 404s on an unknown dataset', async () => {
    expect((await get(`/api/data-room/dentally/appointments?${WIN}&limit=0`, 'owner')).status).toBe(400);
    expect((await get(`/api/data-room/dentally/nope?${WIN}`, 'owner')).status).toBe(404);
  });
  it('rejects a malformed :source param with 400 (regex)', async () => {
    expect((await get(`/api/data-room/Dent%20ally/appointments?${WIN}`, 'owner')).status).toBe(400);
  });
});

describe('GET /:source/:dataset/export.csv', () => {
  it('streams text/csv with a download filename and no-store', async () => {
    const res = await get(`/api/data-room/dentally/appointments/export.csv?${WIN}`, 'analyst');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="dentally-appointments_2026-08-01_2026-08-31.csv"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // NOTE: `res.text()` decodes via the WHATWG Encoding Standard, which
    // strips a leading UTF-8 BOM on decode (spec'd TextDecoder behaviour) —
    // that swallows the very byte this test needs to see. Read raw bytes via
    // Buffer instead, which preserves it, to assert the wire content exactly.
    expect(Buffer.from(await res.arrayBuffer()).toString('utf8')).toBe('﻿id\r\nr1\r\n');
    const meta = dataRoomService.streamCsv.mock.calls[0][5];
    expect(typeof meta.isAborted).toBe('function');
    expect(meta.isAborted()).toBe(false);
  });
  it('a service error before the first byte maps to JSON status', async () => {
    dataRoomService.streamCsv.mockRejectedValueOnce(new AppError('PII export is owner-only', 403));
    const res = await get(`/api/data-room/dentally/patients/export.csv?${WIN}&pii=1`, 'analyst');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'PII export is owner-only' });
  });
});
