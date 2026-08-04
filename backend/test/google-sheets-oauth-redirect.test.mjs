// Google Sheets OAuth redirect-URI sharing: when the provider borrows the
// Google Ads OAuth client (no GOOGLE_SHEETS_CLIENT_ID), it must reuse the
// already-registered /oauth/google_ads/callback redirect URI (no Google Cloud
// Console change needed); with a dedicated client it uses its own path. The
// public callback routes on the HMAC-signed state's provider, not the path.
import './setup.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supaRec } from './setup.js';
import { GoogleSheetsProvider } from '../src/lib/integrations/google-sheets-provider.js';
import { signState, verifyState } from '../src/lib/oauth-state.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const ENV_KEYS = ['GOOGLE_SHEETS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_ID', 'BACKEND_PUBLIC_URL'];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  supaRec.resultProvider = () => ({ data: [], error: null });
  process.env.BACKEND_PUBLIC_URL = 'https://api.example.com';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('google_sheets authorize redirect_uri', () => {
  it('borrows the registered google_ads callback when using the Ads client', async () => {
    delete process.env.GOOGLE_SHEETS_CLIENT_ID;
    process.env.GOOGLE_ADS_CLIENT_ID = 'ads-client-id';
    const { redirectUrl } = await GoogleSheetsProvider.authorize(ORG);
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('redirect_uri'))
      .toBe('https://api.example.com/oauth/google_ads/callback');
    expect(url.searchParams.get('client_id')).toBe('ads-client-id');
    // The signed state still identifies the real provider for callback routing.
    expect(verifyState(url.searchParams.get('state')).provider).toBe('google_sheets');
  });

  it('uses its own callback path with a dedicated Sheets client', async () => {
    process.env.GOOGLE_SHEETS_CLIENT_ID = 'sheets-client-id';
    const { redirectUrl } = await GoogleSheetsProvider.authorize(ORG);
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('redirect_uri'))
      .toBe('https://api.example.com/oauth/google_sheets/callback');
    expect(url.searchParams.get('client_id')).toBe('sheets-client-id');
  });
});

describe('shared-callback state routing', () => {
  it('verifyState without an expected provider returns the signed provider', () => {
    const state = signState({ orgId: ORG, provider: 'google_sheets' });
    // This is what the public callback does when google_sheets arrives on the
    // google_ads path: signature-verify, then route on the state's provider.
    expect(verifyState(state)).toEqual({ orgId: ORG, provider: 'google_sheets' });
  });
  it('a tampered state still fails the HMAC', () => {
    const state = signState({ orgId: ORG, provider: 'google_sheets' });
    const [payload] = state.split('.');
    expect(() => verifyState(`${payload}.forged-signature`)).toThrow('invalid_state_signature');
  });
});
