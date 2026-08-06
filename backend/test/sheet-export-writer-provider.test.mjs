// google_sheets_writer OAuth provider — full read/write spreadsheets scope,
// a deliberately separate provider row from the read-only google_sheets
// (Call Reporting) connection. Mirrors google-sheets-oauth-redirect.test.mjs
// conventions.
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('google_sheets_writer provider', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEETS_CLIENT_ID = 'cid';
    process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'csec';
    process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-32-bytes!!';
    process.env.BACKEND_PUBLIC_URL = 'https://api.example.com';
  });

  it('authorize URL requests the FULL spreadsheets scope (write), not readonly', async () => {
    const { GoogleSheetsWriterProvider } =
      await import('../src/lib/integrations/google-sheets-writer-provider.js');
    const { redirectUrl } = await GoogleSheetsWriterProvider.authorize('org-1');
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('scope')).toContain('auth/spreadsheets');
    expect(url.searchParams.get('scope')).not.toContain('spreadsheets.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('state carries provider=google_sheets_writer so the shared callback routes here', async () => {
    const { GoogleSheetsWriterProvider } =
      await import('../src/lib/integrations/google-sheets-writer-provider.js');
    const { verifyState } = await import('../src/lib/oauth-state.js');
    const { redirectUrl } = await GoogleSheetsWriterProvider.authorize('org-1');
    const state = new URL(redirectUrl).searchParams.get('state');
    expect(verifyState(state).provider).toBe('google_sheets_writer');
  });
});
