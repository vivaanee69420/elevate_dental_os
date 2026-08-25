// Google Ads API version resolver. Google retires Ads API versions ~yearly and a
// retired version 404s EVERY call — this has now broken prod connect + the
// nightly spend sync twice (v17, then v21). The resolver must (1) default to a
// version that is still served, and (2) self-heal at runtime: on a 404 from
// the versioned path, probe newer versions unauthenticated (401/403 = alive,
// 404 = retired) and retry once with the first live one.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    DEFAULT_API_VERSION, configuredApiVersion, currentApiVersion, fetchWithApiVersion, resetApiVersionCache,
} = await import('../src/lib/integrations/google-ads-version.js');

const BASE = 'https://googleads.googleapis.com';
const urlFor = (v) => `${BASE}/${v}/customers:listAccessibleCustomers`;
const AUTH = { headers: { Authorization: 'Bearer tok', 'developer-token': 'dev' } };

/** fetch mock: `authed` map for the real call, `probe` map for unauthenticated probes. */
function mockFetch({ authed, probe }) {
    const calls = [];
    global.fetch = vi.fn(async (url, init = {}) => {
        const v = String(url).match(/\/(v\d+)\//)[1];
        const isProbe = !init.headers?.Authorization;
        calls.push({ v, isProbe, method: init.method || 'GET' });
        const status = isProbe ? (probe[v] ?? 404) : (authed[v] ?? 404);
        return { ok: status < 300, status, json: async () => (status < 300 ? { resourceNames: ['customers/1'] } : {}) };
    });
    return calls;
}

beforeEach(() => {
    delete process.env.GOOGLE_ADS_API_VERSION;
    delete process.env.GOOGLE_ADS_API_BASE;
    resetApiVersionCache();
});

describe('configuredApiVersion', () => {
    it('defaults to v25 or newer (v19–v21 are retired; v22 sunsets Oct 2026)', () => {
        const n = Number(configuredApiVersion().replace(/^v/, ''));
        expect(n).toBeGreaterThanOrEqual(25);
        expect(DEFAULT_API_VERSION).toBe(configuredApiVersion());
    });
    it('honours GOOGLE_ADS_API_VERSION (trimmed)', () => {
        process.env.GOOGLE_ADS_API_VERSION = ' v26 \n';
        expect(configuredApiVersion()).toBe('v26');
        expect(currentApiVersion()).toBe('v26');
    });
});

describe('fetchWithApiVersion', () => {
    it('makes exactly one call when the configured version answers', async () => {
        process.env.GOOGLE_ADS_API_VERSION = 'v25';
        const calls = mockFetch({ authed: { v25: 200 }, probe: {} });
        const res = await fetchWithApiVersion(urlFor, AUTH);
        expect(res.status).toBe(200);
        expect(calls).toEqual([{ v: 'v25', isProbe: false, method: 'GET' }]);
    });

    it('on 404 probes newer versions WITHOUT credentials and retries with the first live one', async () => {
        process.env.GOOGLE_ADS_API_VERSION = 'v25';
        const calls = mockFetch({ authed: { v25: 404, v27: 200 }, probe: { v26: 404, v27: 401 } });
        const res = await fetchWithApiVersion(urlFor, AUTH);
        expect(res.status).toBe(200);
        expect(calls).toEqual([
            { v: 'v25', isProbe: false, method: 'GET' },
            { v: 'v26', isProbe: true, method: 'GET' },
            { v: 'v27', isProbe: true, method: 'GET' },
            { v: 'v27', isProbe: false, method: 'GET' },
        ]);
        expect(currentApiVersion()).toBe('v27');
    });

    it('remembers the advanced version so later calls skip the probe', async () => {
        process.env.GOOGLE_ADS_API_VERSION = 'v25';
        const calls = mockFetch({ authed: { v25: 404, v26: 200 }, probe: { v26: 403 } });
        await fetchWithApiVersion(urlFor, AUTH);
        await fetchWithApiVersion(urlFor, { ...AUTH, method: 'POST' });
        expect(calls.at(-1)).toEqual({ v: 'v26', isProbe: false, method: 'POST' });
        expect(calls.filter((c) => c.isProbe)).toHaveLength(1);
    });

    it('throws an actionable error naming GOOGLE_ADS_API_VERSION when nothing newer responds', async () => {
        process.env.GOOGLE_ADS_API_VERSION = 'v25';
        mockFetch({ authed: { v25: 404 }, probe: {} });
        await expect(fetchWithApiVersion(urlFor, AUTH)).rejects.toThrow(/v25.*retired.*GOOGLE_ADS_API_VERSION/s);
    });

    it('a 404 from the live version after advancing is returned, not treated as another sunset', async () => {
        process.env.GOOGLE_ADS_API_VERSION = 'v25';
        const calls = mockFetch({ authed: { v25: 404, v26: 404 }, probe: { v26: 401 } });
        const res = await fetchWithApiVersion(urlFor, AUTH);
        expect(res.status).toBe(404);
        expect(calls.filter((c) => c.isProbe)).toHaveLength(1);
    });
});
