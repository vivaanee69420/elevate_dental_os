// Refresh hardening for BOTH Google Sheets providers (read-only Call Reporting
// + writer Conversion Export). Regression tests for the "Unauthorized every
// ~24h" outage: the Cron Jobs service was missing GOOGLE_SHEETS_CLIENT_ID/
// SECRET, fell back to the Google Ads client pair, and every worker-side
// refresh got 401 unauthorized_client → markFailed → the integration (and the
// export drainer, which treats 'failed' as terminal) died until a manual
// reconnect. Refresh must now only mark failed on invalid_grant (token truly
// dead); client/env problems and transient errors leave status untouched.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: {
    upsert: vi.fn(async () => ({})),
    upsertSecrets: vi.fn(async () => ({})),
    getByProvider: vi.fn(async () => null),
    markFailed: vi.fn(async () => ({})),
    markRevoked: vi.fn(async () => ({})),
    claimRefresh: vi.fn(async () => true),
    clearRefresh: vi.fn(async () => ({})),
  },
}));

const { integrationRepository } = await import('../src/repositories/integration.repository.js');
const { encryptSecret } = await import('../src/lib/crypto.js');

function tokenErrorResponse(status, body) {
  return { ok: false, status, json: async () => body };
}

function storedIntegration(overrides = {}) {
  return {
    status: 'active',
    secrets: encryptSecret(JSON.stringify({ access_token: 'at', refresh_token: 'rt' })),
    config: {},
    expires_at: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}

const PROVIDERS = [
  ['google_sheets', '../src/lib/integrations/google-sheets-provider.js', 'GoogleSheetsProvider'],
  ['google_sheets_writer', '../src/lib/integrations/google-sheets-writer-provider.js', 'GoogleSheetsWriterProvider'],
];

describe.each(PROVIDERS)('%s refresh hardening', (providerId, modulePath, exportName) => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_SHEETS_CLIENT_ID = 'cid';
    process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'csec';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT mark failed on 401 unauthorized_client (server env problem, token is fine)', async () => {
    const mod = await import(modulePath);
    integrationRepository.getByProvider.mockResolvedValue(storedIntegration());
    vi.stubGlobal('fetch', vi.fn(async () => tokenErrorResponse(401, {
      error: 'unauthorized_client', error_description: 'Unauthorized',
    })));
    await expect(mod[exportName].refresh('org-1')).rejects.toThrow(/GOOGLE_SHEETS_CLIENT_ID/);
    expect(integrationRepository.markFailed).not.toHaveBeenCalled();
    expect(integrationRepository.clearRefresh).toHaveBeenCalled();
  });

  it('does NOT mark failed on a transient token-endpoint 500', async () => {
    const mod = await import(modulePath);
    integrationRepository.getByProvider.mockResolvedValue(storedIntegration());
    vi.stubGlobal('fetch', vi.fn(async () => tokenErrorResponse(500, { error: 'internal_failure' })));
    await expect(mod[exportName].refresh('org-1')).rejects.toThrow();
    expect(integrationRepository.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed on invalid_grant (refresh token genuinely dead — owner must reconnect)', async () => {
    const mod = await import(modulePath);
    integrationRepository.getByProvider.mockResolvedValue(storedIntegration());
    vi.stubGlobal('fetch', vi.fn(async () => tokenErrorResponse(400, {
      error: 'invalid_grant', error_description: 'Token has been expired or revoked.',
    })));
    await expect(mod[exportName].refresh('org-1')).rejects.toThrow(/expired or revoked/);
    expect(integrationRepository.markFailed).toHaveBeenCalledWith(
      'org-1', providerId, 'Token has been expired or revoked.',
    );
  });

  it('fails fast on client mismatch (config.oauth_client_id != env) without calling Google', async () => {
    const mod = await import(modulePath);
    integrationRepository.getByProvider.mockResolvedValue(storedIntegration({
      config: { oauth_client_id: 'the-client-that-issued-the-token' },
    }));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(mod[exportName].refresh('org-1')).rejects.toThrow(/env mismatch/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(integrationRepository.markFailed).not.toHaveBeenCalled();
  });

  it('stamps the issuing oauth_client_id into config on a successful refresh', async () => {
    const mod = await import(modulePath);
    integrationRepository.getByProvider.mockResolvedValue(storedIntegration({
      config: { oauth_client_id: 'cid' },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-at', token_type: 'Bearer', expires_in: 3599, scope: 's' }),
    })));
    await expect(mod[exportName].refresh('org-1')).resolves.toEqual({ ok: true });
    expect(integrationRepository.upsertSecrets).toHaveBeenCalledWith(
      'org-1', providerId,
      expect.objectContaining({ config: expect.objectContaining({ oauth_client_id: 'cid' }) }),
    );
  });
});

describe('topUp clears a stale failed source once a read succeeds', () => {
  it('resets status/last_error before recording the top-up', async () => {
    vi.resetModules();
    vi.doMock('../src/repositories/sheet.repository.js', () => ({
      sheetRepository: {
        updateSource: vi.fn(async () => ({})),
        upsertLeads: vi.fn(async () => ({})),
      },
    }));
    vi.doMock('../src/lib/integrations/google-sheets-provider.js', () => ({
      sheetsFetch: vi.fn(async () => ({ valueRanges: [] })),
    }));
    const { topUp } = await import('../src/lib/integrations/google-sheets-sync.js');
    const { sheetRepository } = await import('../src/repositories/sheet.repository.js');
    const source = {
      id: 'src-1',
      status: 'failed',
      last_error: 'Unauthorized',
      tab_name: 'Leads',
      header_row: 1,
      last_synced_row: 10,
      row_count: 10,
      skipped_rows: 0,
      sheet_timezone: 'Europe/London',
      column_mapping: { date: 0, created_time: 1, called_3m: 2, called_10m: 3, pipeline_name: 4 },
    };
    const result = await topUp('org-1', source);
    expect(result).toEqual({ ok: true, added: 0 });
    expect(sheetRepository.updateSource).toHaveBeenCalledWith(
      'org-1', 'src-1', { status: 'active', last_error: null },
    );
    vi.doUnmock('../src/repositories/sheet.repository.js');
    vi.doUnmock('../src/lib/integrations/google-sheets-provider.js');
  });
});
