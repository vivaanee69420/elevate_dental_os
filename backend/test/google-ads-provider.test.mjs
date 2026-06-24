// Google Ads OAuth provider — callback account discovery. Regression cover for:
//  1. Default API version must be currently-supported (a sunset version 404s
//     every Ads call; v17 was sunset and silently broke connect — see fix).
//  2. An empty accessible-customer list (the consenting Google account has no
//     Google Ads account) must fail with the NO_AD_ACCOUNT code, not a silent
//     "active" row that the sync later rejects with a misleading message.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        upsert: vi.fn(),
        upsertSecrets: vi.fn(),
        markFailed: vi.fn(),
        getByProvider: vi.fn(),
        upsertAdAccounts: vi.fn(),
    },
}));

const { GoogleAdsProvider, listAccessibleCustomers, adsHeaders } = await import('../src/lib/integrations/google-ads-provider.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

const TOKEN_OK = {
    ok: true, status: 200,
    json: async () => ({ access_token: 'tok', refresh_token: 'r', token_type: 'Bearer', expires_in: 3600 }),
};

beforeEach(() => {
    process.env.GOOGLE_ADS_CLIENT_ID = 'cid';
    process.env.GOOGLE_ADS_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'devtoken';
    delete process.env.GOOGLE_ADS_API_VERSION;
    integrationRepository.upsertSecrets.mockReset();
    integrationRepository.markFailed.mockReset();
});

describe('adsHeaders', () => {
    it('includes login-customer-id (dashes stripped) by default, omits it when withLogin:false', () => {
        process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '123-456-7890';
        expect(adsHeaders('tok')['login-customer-id']).toBe('1234567890');
        expect(adsHeaders('tok', { withLogin: false })['login-customer-id']).toBeUndefined();
        delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    });
});

describe('listAccessibleCustomers', () => {
    // customers:listAccessibleCustomers lists accounts for the AUTHENTICATED
    // credential — it must NOT be scoped to an MCC. Sending login-customer-id
    // (esp. one the OAuth user can't act under) makes Google return
    // INVALID_ARGUMENT ("Request contains an invalid argument") and breaks connect.
    it('does NOT send login-customer-id even when the env is set', async () => {
        process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '123-456-7890';
        let headers = null;
        global.fetch = vi.fn(async (url, opts) => {
            headers = opts?.headers ?? {};
            return { ok: true, status: 200, json: async () => ({ resourceNames: ['customers/123'] }) };
        });
        await listAccessibleCustomers('tok');
        expect(headers['login-customer-id']).toBeUndefined();
        delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    });

    it('fails fast with a clear message when GOOGLE_ADS_DEVELOPER_TOKEN is not configured', async () => {
        delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        global.fetch = vi.fn();
        await expect(listAccessibleCustomers('tok')).rejects.toThrow(/GOOGLE_ADS_DEVELOPER_TOKEN/);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only developer token as not configured', async () => {
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN = '   \n';
        global.fetch = vi.fn();
        await expect(listAccessibleCustomers('tok')).rejects.toThrow(/GOOGLE_ADS_DEVELOPER_TOKEN/);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('surfaces the specific Google Ads error code, not just the generic top-level message', async () => {
        global.fetch = vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => ({
                error: {
                    code: 400,
                    message: 'Request contains an invalid argument.',
                    status: 'INVALID_ARGUMENT',
                    details: [{
                        '@type': 'type.googleapis.com/google.ads.googleads.v20.errors.GoogleAdsFailure',
                        errors: [{
                            errorCode: { authenticationError: 'DEVELOPER_TOKEN_PROHIBITED' },
                            message: "The developer token is not allowed with project '123'.",
                        }],
                        requestId: 'req-1',
                    }],
                },
            }),
        }));
        await expect(listAccessibleCustomers('tok')).rejects.toThrow(/DEVELOPER_TOKEN_PROHIBITED/);
    });

    it('calls a currently-supported API version by default (not a sunset one)', async () => {
        let calledUrl = '';
        global.fetch = vi.fn(async (url) => {
            calledUrl = String(url);
            return { ok: true, status: 200, json: async () => ({ resourceNames: ['customers/123'] }) };
        });
        await listAccessibleCustomers('tok');
        // v15..v19 are sunset and 404. Guard against a regression back to them.
        expect(calledUrl).not.toMatch(/\/v1[0-9]\//);
        expect(calledUrl).toMatch(/\/v2[0-9]\/customers:listAccessibleCustomers$/);
    });
});

describe('callback account discovery', () => {
    it('throws NO_AD_ACCOUNT when the login has no accessible Ads account', async () => {
        global.fetch = vi.fn(async (url) => {
            if (String(url).includes('listAccessibleCustomers')) {
                return { ok: true, status: 200, json: async () => ({ resourceNames: [] }) };
            }
            return TOKEN_OK; // token exchange
        });
        await expect(GoogleAdsProvider.callback('org-1', { code: 'abc' })).rejects.toThrow('NO_AD_ACCOUNT');
        expect(integrationRepository.markFailed).toHaveBeenCalledWith('org-1', 'google_ads', 'NO_AD_ACCOUNT');
        expect(integrationRepository.upsertSecrets).not.toHaveBeenCalled();
    });

    it('persists active when at least one accessible account is found', async () => {
        global.fetch = vi.fn(async (url) => {
            if (String(url).includes('listAccessibleCustomers')) {
                return { ok: true, status: 200, json: async () => ({ resourceNames: ['customers/9074914150'] }) };
            }
            return TOKEN_OK;
        });
        const res = await GoogleAdsProvider.callback('org-1', { code: 'abc' });
        expect(res.customerIds).toEqual(['9074914150']);
        expect(integrationRepository.upsertSecrets).toHaveBeenCalled();
        expect(integrationRepository.markFailed).not.toHaveBeenCalled();
    });
});
