// ============================================================================
// CallRail companies — Task 4: repository (callrail_calls only), service
// (companies: add/update/remove/sync + status), and the controller's
// agency-actor guard on practiceId.
//
// Three layers, three mocking strategies in one file:
//  - callrailRepository (real, unmocked) against the shared fake Supabase
//    client from test/setup.js (`supaRec`) — proves the actual query shapes:
//    org scoping, the upsert conflict key, grouped-aggregate call shapes, and
//    that counting a company's calls is O(1) requests, never a row scan.
//  - callrailService, with every repository it depends on replaced by a
//    small in-memory fake (vi.doMock + vi.resetModules + dynamic import,
//    mirroring test/ghl-account.service.test.js) — proves the orchestration:
//    unmapped companies stay visible, a practice change restamps history,
//    removing a company never touches callrail_calls, cross-org isolation.
//  - integrationController's callrailAccount* handlers, with callrail.service
//    mocked — proves the practiceId agency-actor guard and that org id always
//    comes from the session.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { callrailRepository } from '../src/repositories/callrail.repository.js';

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';

// ============================================================================
// Layer 1 — callrailRepository, the ONLY repository touching callrail_calls.
// ============================================================================
describe('callrailRepository', () => {
    beforeEach(() => {
        supaRec.last = undefined;
        supaRec.resultProvider = () => ({ data: [], error: null });
    });

    describe('upsertCalls', () => {
        it('stamps organisation_id and upserts on the (organisation_id, callrail_id) conflict key', async () => {
            let captured;
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
                    captured = q;
                    const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
                    return { data: rows.map((_, i) => ({ id: `row-${i}` })), error: null };
                }
                return { data: [], error: null };
            };
            await callrailRepository.upsertCalls(ORG_A, [{ callrail_id: 'CR-1', started_at: '2026-09-01T10:00:00Z' }]);
            expect(captured.upsertOpts.onConflict).toBe('organisation_id,callrail_id');
            expect(captured.upsertVals[0]).toMatchObject({ organisation_id: ORG_A, callrail_id: 'CR-1' });
        });

        it('is idempotent: upserting the same call twice yields one stored row', async () => {
            // A real per-test in-memory store, keyed exactly like the DB's own
            // unique constraint (organisation_id, callrail_id) — proves the
            // repository always targets that conflict key, not just that it
            // issues an upsert-shaped call.
            const store = new Map();
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
                    const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
                    const out = [];
                    for (const r of rows) {
                        const key = `${r.organisation_id}|${r.callrail_id}`;
                        const id = store.get(key)?.id ?? `row-${store.size + 1}`;
                        store.set(key, { ...r, id });
                        out.push({ id });
                    }
                    return { data: out, error: null };
                }
                return { data: [], error: null };
            };

            const row = { callrail_id: 'CR-1', started_at: '2026-09-01T10:00:00Z', duration_seconds: 90 };
            await callrailRepository.upsertCalls(ORG_A, [row]);
            await callrailRepository.upsertCalls(ORG_A, [{ ...row, duration_seconds: 120 }]); // a re-delivery, e.g. webhook + nightly pull

            expect(store.size).toBe(1);
            expect(store.get(`${ORG_A}|CR-1`).duration_seconds).toBe(120); // last write wins, still one row
        });

        it('chunks a large batch into multiple upserts rather than one oversized request', async () => {
            let upsertRequests = 0;
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls' && q.upsertVals !== undefined) {
                    upsertRequests += 1;
                    const rows = Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals];
                    return { data: rows.map((_, i) => ({ id: `r-${upsertRequests}-${i}` })), error: null };
                }
                return { data: [], error: null };
            };
            const rows = Array.from({ length: 1200 }, (_, i) => ({ callrail_id: `CR-${i}`, started_at: '2026-09-01T00:00:00Z' }));
            const result = await callrailRepository.upsertCalls(ORG_A, rows);
            expect(upsertRequests).toBe(3); // 500 + 500 + 200
            expect(result.upserted).toBe(1200);
        });

        it('does nothing for an empty batch (no request at all)', async () => {
            let requests = 0;
            supaRec.resultProvider = () => { requests += 1; return { data: [], error: null }; };
            const result = await callrailRepository.upsertCalls(ORG_A, []);
            expect(result).toEqual({ upserted: 0 });
            expect(requests).toBe(0);
        });
    });

    describe('callCountsByAccount — aggregates in SQL, never pages calls into Node', () => {
        it('issues exactly one org+company-scoped, count-exact query PER id — the read count equals the id count, not the call count', async () => {
            let queries = 0;
            const seenIds = [];
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls') {
                    queries += 1;
                    const idEq = q.eqs.find((e) => e.col === 'integration_account_id');
                    const orgEq = q.eqs.find((e) => e.col === 'organisation_id');
                    seenIds.push(idEq?.val);
                    expect(orgEq).toEqual({ col: 'organisation_id', val: ORG_A });
                    // Simulate a company with a large call history — the READ
                    // COUNT assertion below (not this number) is what proves
                    // calls were never paged into memory to be counted.
                    return { data: [{ started_at: '2026-09-03T09:00:00Z' }], count: 48213, error: null };
                }
                return { data: [], error: null };
            };

            const out = await callrailRepository.callCountsByAccount(ORG_A, ['acc-1', 'acc-2', 'acc-3']);

            // TERMINATION / SCOPE: one request per known company id, full stop —
            // there is no loop over calls, no .range() paging of call rows.
            expect(queries).toBe(3);
            expect(seenIds.sort()).toEqual(['acc-1', 'acc-2', 'acc-3']);
            expect(out).toHaveLength(3);
            expect(out.every((c) => c.callCount === 48213)).toBe(true);
            expect(out.find((c) => c.integrationAccountId === 'acc-1').lastCallAt).toBe('2026-09-03T09:00:00Z');
        });

        it('de-dupes requested ids and skips null/undefined entries — never more requests than distinct companies', async () => {
            let queries = 0;
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls') { queries += 1; return { data: [], count: 0, error: null }; }
                return { data: [], error: null };
            };
            await callrailRepository.callCountsByAccount(ORG_A, ['acc-1', 'acc-1', null, undefined, 'acc-2']);
            expect(queries).toBe(2);
        });

        it('a company with zero calls comes back with callCount 0 and lastCallAt null, not omitted', async () => {
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls') return { data: [], count: 0, error: null };
                return { data: [], error: null };
            };
            const out = await callrailRepository.callCountsByAccount(ORG_A, ['acc-empty']);
            expect(out).toEqual([{ integrationAccountId: 'acc-empty', callCount: 0, lastCallAt: null }]);
        });
    });

    describe('sourceBreakdown — grouped + counted in one query, org-wide', () => {
        it('issues exactly ONE call, to the RPC, scoped to the org — not a table scan and not one read per source', async () => {
            const calls = [];
            supaRec.rpcProvider = (fn, args) => {
                calls.push({ fn, args });
                return {
                    data: [
                        { source: 'google_ads', call_count: 512 },
                        { source: 'organic', call_count: 40 },
                        { source: null, call_count: 3 },
                    ],
                    error: null,
                };
            };

            const out = await callrailRepository.sourceBreakdown(ORG_A);

            // TERMINATION: one grouped RPC. Aggregate-select is NOT usable here —
            // PostgREST answers PGRST123 "Use of aggregate functions is not
            // allowed" on this project, verified against the hosted endpoint.
            expect(calls).toEqual([{ fn: 'callrail_source_breakdown', args: { p_org: ORG_A } }]);
            expect(out).toEqual([
                { source: 'google_ads', callCount: 512 },
                { source: 'organic', callCount: 40 },
                { source: null, callCount: 3 },
            ]);
        });

        it('reports what CallRail says even when it contradicts "every call is an ad call"', async () => {
            supaRec.rpcProvider = () => ({
                data: [{ source: 'organic_search', call_count: 900 }, { source: 'paid_search', call_count: 100 }],
                error: null,
            });
            const out = await callrailRepository.sourceBreakdown(ORG_A);
            expect(out.find((s) => s.source === 'organic_search').callCount).toBe(900);
        });
    });

    describe('restampPractice', () => {
        it('scopes the update by BOTH organisation_id and integration_account_id', async () => {
            let captured;
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls' && q.op === 'update') { captured = q; return { data: null, error: null }; }
                return { data: [], error: null };
            };
            await callrailRepository.restampPractice(ORG_A, 'acc-1', 'practice-2');
            expect(captured.updateVals).toEqual({ practice_id: 'practice-2' });
            expect(captured.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
            expect(captured.eqs).toContainEqual({ col: 'integration_account_id', val: 'acc-1' });
        });

        it('unmapping writes practice_id: null', async () => {
            let captured;
            supaRec.resultProvider = (q) => {
                if (q.table === 'callrail_calls' && q.op === 'update') { captured = q; return { data: null, error: null }; }
                return { data: [], error: null };
            };
            await callrailRepository.restampPractice(ORG_A, 'acc-1', null);
            expect(captured.updateVals).toEqual({ practice_id: null });
        });
    });

    it('cross-org isolation: every callrail_calls query this repository issues carries organisation_id', async () => {
        const seen = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'callrail_calls') seen.push(q);
            return { data: [], error: null, count: 0 };
        };
        await callrailRepository.callCountsByAccount(ORG_A, ['acc-1']);
        await callrailRepository.sourceBreakdown(ORG_A);
        await callrailRepository.upsertCalls(ORG_A, [{ callrail_id: 'X', started_at: 't' }]);
        await callrailRepository.restampPractice(ORG_A, 'acc-1', null);

        expect(seen.length).toBeGreaterThan(0);
        // An upsert carries the org id IN the written row (upsertVals), not as
        // a WHERE .eq() filter — every read/update, by contrast, filters by
        // .eq('organisation_id', ...). Both are "carries organisation_id";
        // only the mechanism differs by query shape.
        const carriesOrg = (q) => (q.upsertVals !== undefined)
            ? (Array.isArray(q.upsertVals) ? q.upsertVals : [q.upsertVals]).every((r) => r.organisation_id === ORG_A)
            : q.eqs.some((e) => e.col === 'organisation_id' && e.val === ORG_A);
        expect(seen.every(carriesOrg)).toBe(true);
    });
});

// ============================================================================
// Layer 2 — callrailService, orchestrating integration_accounts +
// callrail_calls. Every repository is a small in-memory fake so tests assert
// business behaviour, not query plumbing (already covered above).
// ============================================================================
describe('callrailService', () => {
    let svc;
    let accountsStore;
    let verifyMock;
    let listCompaniesMock;
    let listAccountsMock;
    let callrailRepoMock;
    let pullMock;

    function seedAccount(fields) {
        accountsStore.push({ provider: 'callrail', status: 'active', practice_id: null, label: null, ...fields });
    }

    beforeEach(async () => {
        vi.resetModules();
        accountsStore = [];
        verifyMock = vi.fn(async () => 'CallRail Account Name');

        vi.doMock('../src/repositories/integration-account.repository.js', () => ({
            integrationAccountRepository: {
                list: vi.fn(async (org, provider) =>
                    accountsStore.filter((a) => a.organisation_id === org && a.provider === provider)
                        .map(({ secrets, ...safe }) => safe)),
                getById: vi.fn(async (org, id) => {
                    const row = accountsStore.find((a) => a.organisation_id === org && a.id === id);
                    if (!row) return null;
                    const { secrets, ...safe } = row;
                    return safe;
                }),
                // FULL row, secrets included — callrailService.syncAccount uses
                // this (not getById) because callrail-sync.js's syncAccount
                // needs the encrypted API key.
                getByIdWithSecrets: vi.fn(async (org, id) =>
                    accountsStore.find((a) => a.organisation_id === org && a.id === id) ?? null),
                // FULL row (mirrors the real repo's select('*')) — used by
                // addAccount's dup-check ahead of a live 409 vs a revoked-row
                // reconnect. Deliberately NOT status-filtered here — the real
                // getByLocation returns whatever exists, live or revoked; the
                // SERVICE is what decides what to do with it.
                getByLocation: vi.fn(async (org, provider, externalId) =>
                    accountsStore.find((a) => a.organisation_id === org && a.provider === provider && a.external_account_id === externalId) ?? null),
                insert: vi.fn(async (org, fields) => {
                    const row = { id: `acc-${accountsStore.length + 1}`, organisation_id: org, ...fields };
                    accountsStore.push(row);
                    const { secrets, ...safe } = row;
                    return safe;
                }),
                update: vi.fn(async (org, id, patch) => {
                    const row = accountsStore.find((a) => a.organisation_id === org && a.id === id);
                    Object.assign(row, patch);
                    const { secrets, ...safe } = row;
                    return safe;
                }),
                // Shallow-merges into config (mirrors the real repo) — used by
                // updateAccount to flip the non-secret has_signing_key flag
                // without clobbering config.account_id.
                mergeConfig: vi.fn(async (org, id, patch) => {
                    const row = accountsStore.find((a) => a.organisation_id === org && a.id === id);
                    if (!row) return patch;
                    row.config = { ...(row.config ?? {}), ...patch };
                    return row.config;
                }),
                markRevoked: vi.fn(async (org, id) => {
                    const row = accountsStore.find((a) => a.organisation_id === org && a.id === id);
                    if (row) { row.status = 'revoked'; row.secrets = null; }
                }),
            },
        }));

        vi.doMock('../src/repositories/integration.repository.js', () => ({
            integrationRepository: {
                getByProvider: vi.fn(async () => ({ status: 'active' })),
                upsert: vi.fn(async () => ({})),
                markRevoked: vi.fn(async () => {}),
            },
        }));

        vi.doMock('../src/repositories/callrail.repository.js', () => ({
            callrailRepository: {
                callCountsByAccount: vi.fn(async (org, ids) => ids.map((id) => ({ integrationAccountId: id, callCount: 0, lastCallAt: null }))),
                sourceBreakdown: vi.fn(async () => []),
                restampPractice: vi.fn(async () => {}),
                upsertCalls: vi.fn(async () => ({ upserted: 0 })),
            },
        }));

        listCompaniesMock = vi.fn(async () => ([{ id: 'CR-1', name: 'CallRail Company Name' }]));
        listAccountsMock = vi.fn(async () => ([{ id: 'ACC-1', name: 'CallRail Account Name' }]));
        vi.doMock('../src/lib/integrations/callrail-provider.js', () => ({
            callrailProvider: { verify: verifyMock, listCompanies: listCompaniesMock, listAccounts: listAccountsMock },
        }));

        // The actual HTTP pull is Task 6's own suite (callrail-sync.test.mjs) —
        // stubbed here so this file stays about callrailService's
        // ORCHESTRATION (does it resolve the right account, pass it through,
        // shape the response), not about pagination/upsert mechanics.
        pullMock = vi.fn(async () => ({ ingested: 0 }));
        vi.doMock('../src/lib/integrations/callrail-sync.js', () => ({ syncAccount: pullMock }));

        vi.doMock('../src/lib/integration-gating.js', () => ({ invalidate: vi.fn() }));

        // practiceNamesFor() and assertOrgOwns() are NOT mocked — they go
        // through the real lib/supabase.js -> the shared fake from
        // test/setup.js, exactly like the repository layer above.
        supaRec.last = undefined;
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices') {
                const PRACTICES = [
                    { id: 'practice-1', organisation_id: ORG_A, name: 'Ashford' },
                    { id: 'practice-2', organisation_id: ORG_A, name: 'Bexleyheath' },
                ];
                const idEq = q.eqs.find((e) => e.col === 'id');
                const orgEq = q.eqs.find((e) => e.col === 'organisation_id');
                if (idEq) {
                    // assertOrgOwns: .eq('id', x).eq('organisation_id', y).maybeSingle()
                    const hit = PRACTICES.find((p) => p.id === idEq.val && (!orgEq || p.organisation_id === orgEq.val));
                    return { data: hit ?? null, error: null };
                }
                const inFilter = (q.ins || []).find((i) => i.col === 'id');
                let rows = PRACTICES.filter((p) => !orgEq || p.organisation_id === orgEq.val);
                if (inFilter) rows = rows.filter((p) => inFilter.vals.includes(p.id));
                return { data: rows, error: null };
            }
            return { data: [], error: null };
        };

        svc = (await import('../src/services/callrail.service.js')).callrailService;
        callrailRepoMock = (await import('../src/repositories/callrail.repository.js')).callrailRepository;
    });

    describe('status', () => {
        it('a company connected but not mapped to a practice is listed, with a null practice — never hidden', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Warwick Lodge', practice_id: null });
            const status = await svc.status(ORG_A);
            expect(status.accounts).toHaveLength(1);
            expect(status.accounts[0].practiceId).toBeNull();
            expect(status.accounts[0].practiceName).toBeNull();
        });

        it('a mapped company resolves its practice name', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', practice_id: 'practice-1' });
            const status = await svc.status(ORG_A);
            expect(status.accounts[0].practiceId).toBe('practice-1');
            expect(status.accounts[0].practiceName).toBe('Ashford');
        });

        it('passes the source breakdown through unchanged', async () => {
            callrailRepoMock.sourceBreakdown.mockResolvedValueOnce([
                { source: 'google_ads', callCount: 12 },
                { source: null, callCount: 3 },
            ]);
            const status = await svc.status(ORG_A);
            expect(status.sourceBreakdown).toEqual([
                { source: 'google_ads', callCount: 12 },
                { source: null, callCount: 3 },
            ]);
        });

        it('a removed company leaves the panel, but its calls still count in the source breakdown', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-live', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford' });
            seedAccount({ organisation_id: ORG_A, id: 'acc-gone', external_account_id: 'CR-2', webhook_token: 'tok-2', label: 'Bexleyheath', status: 'revoked' });
            callrailRepoMock.sourceBreakdown.mockResolvedValueOnce([{ source: 'google_ads', callCount: 42 }]);

            const status = await svc.status(ORG_A);

            // Disconnect is a soft revoke — the row survives so its calls keep
            // their integration_account_id — but an owner who clicks Disconnect
            // and still sees the company has been told the action failed.
            expect(status.accounts.map((a) => a.id)).toEqual(['acc-live']);
            // The revoked company's historical calls really happened, so the
            // org-wide breakdown still counts them.
            expect(status.sourceBreakdown).toEqual([{ source: 'google_ads', callCount: 42 }]);
        });

        it('connected reflects the provider marker row status', async () => {
            const integrationRepo = (await import('../src/repositories/integration.repository.js')).integrationRepository;
            integrationRepo.getByProvider.mockResolvedValueOnce(null);
            const status = await svc.status(ORG_A);
            expect(status.connected).toBe(false);
        });

        it("cross-org isolation: one org's companies never appear in another org's status", async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-A1', external_account_id: 'CR-A', webhook_token: 'tok-A', label: 'A' });
            seedAccount({ organisation_id: ORG_B, id: 'acc-B1', external_account_id: 'CR-B', webhook_token: 'tok-B', label: 'B' });
            const statusA = await svc.status(ORG_A);
            expect(statusA.accounts.map((a) => a.id)).toEqual(['acc-A1']);
        });
    });

    describe('addAccount', () => {
        it('verifies the key with CallRail BEFORE persisting anything', async () => {
            verifyMock.mockRejectedValueOnce(new Error('CallRail rejected this API key for account ACC-1. Check the key and account ID and try again.'));
            await expect(svc.addAccount(ORG_A, { apiKey: 'bad', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' }))
                .rejects.toThrow(/rejected this API key/i);
            expect(accountsStore).toHaveLength(0);
        });

        it('rejects when callrailCompanyId is missing, and never calls verify', async () => {
            await expect(svc.addAccount(ORG_A, { apiKey: 'k', callrailAccountId: 'ACC-1', label: 'Ashford' }))
                .rejects.toThrow(/callrailCompanyId/i);
            expect(verifyMock).not.toHaveBeenCalled();
            expect(accountsStore).toHaveLength(0);
        });

        it('verifies against BOTH the CallRail account id and the company id — never conflated', async () => {
            await svc.addAccount(ORG_A, { apiKey: 'super-secret-key', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' });
            expect(verifyMock).toHaveBeenCalledWith('super-secret-key', 'ACC-1', 'CR-1');
        });

        it('encrypts the key, never returns it, and mints a fresh random webhook token', async () => {
            const out = await svc.addAccount(ORG_A, { apiKey: 'super-secret-key', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' });
            expect(out).not.toHaveProperty('secrets');
            expect(JSON.stringify(out)).not.toContain('super-secret-key');

            const row = accountsStore.find((a) => a.id === out.id);
            expect(row.secrets).toBeTruthy();
            expect(row.secrets).not.toContain('super-secret-key');
            expect(row.webhook_token).toMatch(/^[a-f0-9]{48}$/); // crypto.randomBytes(24).toString('hex')
            expect(out.webhookUrl).toContain(row.webhook_token);
        });

        it('stores the COMPANY id on external_account_id and the ACCOUNT id on config.account_id — both surfaced on the DTO, never conflated', async () => {
            const out = await svc.addAccount(ORG_A, { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' });
            expect(out.callrailAccountId).toBe('ACC-1');
            expect(out.callrailCompanyId).toBe('CR-1');

            const row = accountsStore.find((a) => a.id === out.id);
            expect(row.external_account_id).toBe('CR-1');
            expect(row.config.account_id).toBe('ACC-1');
        });

        it('adds an unmapped company when practiceId is omitted', async () => {
            const out = await svc.addAccount(ORG_A, { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-2', label: 'Bexleyheath' });
            expect(out.practiceId).toBeNull();
            expect(out.practiceName).toBeNull();
        });

        it('rejects a practiceId that does not belong to the org', async () => {
            await expect(svc.addAccount(ORG_A, { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-3', label: 'X', practiceId: 'practice-nope' }))
                .rejects.toThrow(/not found/i);
            expect(accountsStore).toHaveLength(0);
        });

        // FIX for "a rotated API key can never be replaced": the old flow's
        // only advertised recovery was disconnect-and-reconnect, which used
        // to 500 (a bare Error on the DB's unique-violation, masked by
        // errorHandler) because the revoked row still held the unique
        // (org, provider, company) slot. Mirrors ghl-account.service.js's
        // addAccount exactly: a LIVE duplicate 409s; a REVOKED one reconnects.
        describe('reconnect / duplicate handling (the "disconnect and add it again" fix)', () => {
            it('rejects with a clear 409 when the SAME company is already connected and NOT revoked', async () => {
                seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', config: { account_id: 'ACC-1' } });
                await expect(svc.addAccount(ORG_A, { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford again' }))
                    .rejects.toMatchObject({ statusCode: 409 });
                expect(accountsStore).toHaveLength(1); // no second row inserted
            });

            it('reconnects (UPDATES) a REVOKED row for the same company instead of inserting a second one', async () => {
                seedAccount({
                    organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-old', label: 'Ashford',
                    status: 'revoked', secrets: null, config: { account_id: 'ACC-1' },
                });

                const out = await svc.addAccount(ORG_A, { apiKey: 'new-key', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' });

                expect(out.id).toBe('acc-1'); // the SAME row — call history keeps its integration_account_id
                expect(accountsStore).toHaveLength(1); // never a second row
                const row = accountsStore.find((a) => a.id === 'acc-1');
                expect(row.status).toBe('active');
                expect(row.secrets).toBeTruthy();
                expect(row.webhook_token).not.toBe('tok-old'); // rotated on reconnect, mirrors GHL
            });

            it('a different company reconnecting is unaffected by another org\'s revoked row with the same company id', async () => {
                seedAccount({ organisation_id: ORG_B, id: 'acc-b1', external_account_id: 'CR-1', webhook_token: 'tok-b', label: 'B', status: 'revoked', config: { account_id: 'ACC-1' } });
                const out = await svc.addAccount(ORG_A, { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' });
                expect(out.id).not.toBe('acc-b1');
                expect(accountsStore.filter((a) => a.organisation_id === ORG_A)).toHaveLength(1);
                expect(accountsStore.find((a) => a.id === 'acc-b1').status).toBe('revoked'); // untouched
            });
        });

        it('kicks off a FULL (opts.full: true) pull in the background right after connecting — the owner does not wait for tonight\'s cron', async () => {
            const out = await svc.addAccount(ORG_A, { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' });
            await vi.waitFor(() => expect(pullMock).toHaveBeenCalledTimes(1));
            const [passedOrg, passedAccount, , passedOpts] = pullMock.mock.calls[0];
            expect(passedOrg).toBe(ORG_A);
            expect(passedAccount).toMatchObject({ id: out.id, secrets: expect.any(String) }); // the FULL row, secrets included
            expect(passedOpts).toEqual({ full: true });
        });
    });

    describe('discoverAccounts — key-only discovery (Add-company step 1)', () => {
        it('lists every account the key can see, then every company under each, without persisting anything', async () => {
            listAccountsMock.mockResolvedValueOnce([{ id: 'ACC-1', name: 'Last Mile Metrics' }, { id: 'ACC-2', name: 'Second Group' }]);
            listCompaniesMock.mockImplementation(async (key, accountId) => (accountId === 'ACC-1'
                ? [{ id: 'CR-1', name: 'Ashford' }]
                : [{ id: 'CR-2', name: 'Bexleyheath' }]));

            const out = await svc.discoverAccounts(ORG_A, { apiKey: 'k' });

            expect(listAccountsMock).toHaveBeenCalledWith('k');
            expect(listCompaniesMock).toHaveBeenCalledWith('k', 'ACC-1');
            expect(listCompaniesMock).toHaveBeenCalledWith('k', 'ACC-2');
            expect(out.accounts).toEqual([
                { accountId: 'ACC-1', accountName: 'Last Mile Metrics', companies: [{ id: 'CR-1', name: 'Ashford', alreadyConnected: false }] },
                { accountId: 'ACC-2', accountName: 'Second Group', companies: [{ id: 'CR-2', name: 'Bexleyheath', alreadyConnected: false }] },
            ]);
            expect(accountsStore).toHaveLength(0);
        });

        it('marks alreadyConnected true only for a company this ORG already has a live (non-revoked) row for', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-live', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford' });
            seedAccount({ organisation_id: ORG_A, id: 'acc-revoked', external_account_id: 'CR-2', webhook_token: 'tok-2', label: 'Old', status: 'revoked' });
            listAccountsMock.mockResolvedValueOnce([{ id: 'ACC-1', name: 'Account' }]);
            listCompaniesMock.mockResolvedValueOnce([
                { id: 'CR-1', name: 'Ashford' },   // live row exists — already connected
                { id: 'CR-2', name: 'Old' },        // revoked row — reconnectable, NOT "already connected"
                { id: 'CR-3', name: 'New' },        // never connected
            ]);

            const out = await svc.discoverAccounts(ORG_A, { apiKey: 'k' });

            const byId = Object.fromEntries(out.accounts[0].companies.map((c) => [c.id, c.alreadyConnected]));
            expect(byId).toEqual({ 'CR-1': true, 'CR-2': false, 'CR-3': false });
        });

        it("cross-org isolation: another org's connected company never marks alreadyConnected for THIS org", async () => {
            seedAccount({ organisation_id: ORG_B, id: 'acc-b1', external_account_id: 'CR-1', webhook_token: 'tok-b', label: 'B' });
            listAccountsMock.mockResolvedValueOnce([{ id: 'ACC-1', name: 'Account' }]);
            listCompaniesMock.mockResolvedValueOnce([{ id: 'CR-1', name: 'Ashford' }]);

            const out = await svc.discoverAccounts(ORG_A, { apiKey: 'k' });

            expect(out.accounts[0].companies[0].alreadyConnected).toBe(false);
        });

        it('one account\'s companies lookup failing is reported on THAT account, not thrown — other accounts still come back', async () => {
            listAccountsMock.mockResolvedValueOnce([{ id: 'ACC-1', name: 'Good' }, { id: 'ACC-2', name: 'Bad' }]);
            listCompaniesMock.mockImplementation(async (key, accountId) => {
                if (accountId === 'ACC-2') throw new Error('CallRail account ACC-2 was not found. Check the account ID and try again.');
                return [{ id: 'CR-1', name: 'Ashford' }];
            });

            const out = await svc.discoverAccounts(ORG_A, { apiKey: 'k' });

            expect(out.accounts).toHaveLength(2);
            const good = out.accounts.find((a) => a.accountId === 'ACC-1');
            const bad = out.accounts.find((a) => a.accountId === 'ACC-2');
            expect(good.companies).toEqual([{ id: 'CR-1', name: 'Ashford', alreadyConnected: false }]);
            expect(bad.companies).toEqual([]);
            expect(bad.error).toMatch(/not found/i);
        });

        it('rejects with 400 (not 502) when the key itself is bad (401/403)', async () => {
            const err = new Error('CallRail rejected this API key. Check the key and try again.');
            err.callrailStatus = 401;
            listAccountsMock.mockRejectedValueOnce(err);
            await expect(svc.discoverAccounts(ORG_A, { apiKey: 'bad' })).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects with 502 (not 400) when CallRail itself is having trouble (5xx)', async () => {
            const err = new Error('CallRail could not list accounts right now (HTTP 503). Try again shortly.');
            err.callrailStatus = 503;
            listAccountsMock.mockRejectedValueOnce(err);
            await expect(svc.discoverAccounts(ORG_A, { apiKey: 'k' })).rejects.toMatchObject({ statusCode: 502 });
        });

        it('rejects an empty apiKey without ever calling the provider', async () => {
            await expect(svc.discoverAccounts(ORG_A, { apiKey: '  ' })).rejects.toMatchObject({ statusCode: 400 });
            expect(listAccountsMock).not.toHaveBeenCalled();
        });

        it('a key with zero reachable accounts returns an empty list, not an error', async () => {
            listAccountsMock.mockResolvedValueOnce([]);
            const out = await svc.discoverAccounts(ORG_A, { apiKey: 'k' });
            expect(out).toEqual({ accounts: [] });
            expect(listCompaniesMock).not.toHaveBeenCalled();
        });
    });

    describe('bulkConnect — Add-company step 2', () => {
        it('connects every entry via addAccount and reports ok:true per company', async () => {
            const out = await svc.bulkConnect(ORG_A, {
                apiKey: 'k',
                companies: [
                    { accountId: 'ACC-1', companyId: 'CR-1', label: 'Ashford' },
                    { accountId: 'ACC-1', companyId: 'CR-2', label: 'Bexleyheath' },
                ],
            });
            expect(out.results).toHaveLength(2);
            expect(out.results.every((r) => r.ok)).toBe(true);
            expect(out.results.map((r) => r.companyId).sort()).toEqual(['CR-1', 'CR-2']);
            expect(accountsStore).toHaveLength(2);
        });

        it('one bad company does not abort the rest — a 409 duplicate reports ok:false without discarding the others', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', config: { account_id: 'ACC-1' } });

            const out = await svc.bulkConnect(ORG_A, {
                apiKey: 'k',
                companies: [
                    { accountId: 'ACC-1', companyId: 'CR-1', label: 'Ashford again' }, // already connected -> 409
                    { accountId: 'ACC-1', companyId: 'CR-2', label: 'Bexleyheath' },   // fine
                ],
            });

            const failed = out.results.find((r) => r.companyId === 'CR-1');
            const ok = out.results.find((r) => r.companyId === 'CR-2');
            expect(failed.ok).toBe(false);
            expect(failed.error).toMatch(/already connected/i);
            expect(ok.ok).toBe(true);
            // The good entry was still persisted despite the other failing.
            expect(accountsStore.some((a) => a.external_account_id === 'CR-2')).toBe(true);
        });

        it('a verify() failure on one company reports ok:false with the key-safe message, others unaffected, and the key is never leaked', async () => {
            const secretKey = 'sk-super-secret-do-not-leak-123';
            verifyMock.mockImplementation(async (key, accountId, companyId) => {
                if (companyId === 'CR-BAD') throw new Error('CallRail rejected this API key for account ACC-1. Check the key and account ID and try again.');
                return 'Verified Name';
            });

            const out = await svc.bulkConnect(ORG_A, {
                apiKey: secretKey,
                companies: [
                    { accountId: 'ACC-1', companyId: 'CR-BAD', label: 'Bad' },
                    { accountId: 'ACC-1', companyId: 'CR-GOOD', label: 'Good' },
                ],
            });

            const bad = out.results.find((r) => r.companyId === 'CR-BAD');
            const good = out.results.find((r) => r.companyId === 'CR-GOOD');
            expect(bad.ok).toBe(false);
            expect(bad.error).not.toContain(secretKey);
            expect(bad.error).toMatch(/rejected this API key/i);
            expect(JSON.stringify(out)).not.toContain(secretKey);
            expect(good.ok).toBe(true);
        });

        it('a non-agency caller omitting practiceId on every entry connects companies unmapped', async () => {
            const out = await svc.bulkConnect(ORG_A, {
                apiKey: 'k',
                companies: [{ accountId: 'ACC-1', companyId: 'CR-1', label: 'Ashford' }],
            });
            expect(out.results[0].ok).toBe(true);
            expect(out.results[0].account.practiceId).toBeNull();
        });

        it('an agency caller may set practiceId per entry, validated against the org', async () => {
            const out = await svc.bulkConnect(ORG_A, {
                apiKey: 'k',
                companies: [{ accountId: 'ACC-1', companyId: 'CR-1', label: 'Ashford', practiceId: 'practice-1' }],
            });
            expect(out.results[0].ok).toBe(true);
            expect(out.results[0].account.practiceId).toBe('practice-1');
        });

        it('rejects an empty apiKey without connecting anything', async () => {
            await expect(svc.bulkConnect(ORG_A, { apiKey: '', companies: [{ accountId: 'ACC-1', companyId: 'CR-1' }] }))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(accountsStore).toHaveLength(0);
        });

        it('rejects an empty companies array without calling the provider', async () => {
            await expect(svc.bulkConnect(ORG_A, { apiKey: 'k', companies: [] })).rejects.toMatchObject({ statusCode: 400 });
            expect(verifyMock).not.toHaveBeenCalled();
        });

        it("cross-org isolation: bulk-connecting in ORG_A never touches ORG_B's rows", async () => {
            seedAccount({ organisation_id: ORG_B, id: 'acc-b1', external_account_id: 'CR-1', webhook_token: 'tok-b', label: 'B' });
            const out = await svc.bulkConnect(ORG_A, {
                apiKey: 'k',
                companies: [{ accountId: 'ACC-1', companyId: 'CR-1', label: 'Ashford' }],
            });
            expect(out.results[0].ok).toBe(true);
            expect(accountsStore.filter((a) => a.organisation_id === ORG_A)).toHaveLength(1);
            expect(accountsStore.find((a) => a.id === 'acc-b1').organisation_id).toBe(ORG_B); // untouched
        });
    });

    describe('updateAccount — practice changes restamp history', () => {
        it("changing a company's practice restamps its existing calls, scoped by org + account", async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', practice_id: 'practice-1' });
            await svc.updateAccount(ORG_A, 'acc-1', { practiceId: 'practice-2' });
            expect(callrailRepoMock.restampPractice).toHaveBeenCalledWith(ORG_A, 'acc-1', 'practice-2');
        });

        it('unmapping (practiceId: null) also restamps to null', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', practice_id: 'practice-1' });
            await svc.updateAccount(ORG_A, 'acc-1', { practiceId: null });
            expect(callrailRepoMock.restampPractice).toHaveBeenCalledWith(ORG_A, 'acc-1', null);
        });

        it('does NOT restamp when the practice is unchanged', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', practice_id: 'practice-1' });
            await svc.updateAccount(ORG_A, 'acc-1', { practiceId: 'practice-1' });
            expect(callrailRepoMock.restampPractice).not.toHaveBeenCalled();
        });

        it('does NOT restamp on a label-only update (practiceId key absent)', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', practice_id: 'practice-1' });
            await svc.updateAccount(ORG_A, 'acc-1', { label: 'Ashford Dental' });
            expect(callrailRepoMock.restampPractice).not.toHaveBeenCalled();
            expect(accountsStore.find((a) => a.id === 'acc-1').label).toBe('Ashford Dental');
        });

        it("cross-org isolation: another org's account id 404s rather than being updated", async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', practice_id: 'practice-1' });
            await expect(svc.updateAccount(ORG_B, 'acc-1', { label: 'hijacked' })).rejects.toThrow(/not found/i);
            expect(accountsStore.find((a) => a.id === 'acc-1').label).toBe('Ashford'); // untouched
            expect(callrailRepoMock.restampPractice).not.toHaveBeenCalled();
        });
    });

    // Closes the "signature verification is dead code" gap: there was no way
    // to SET integration_accounts' signing key. signingKey is a credential
    // (encrypted into the SAME secrets blob as api_key — the row has only one
    // secrets column) but NOT agency-gated: a tenant owner pasting their own
    // CallRail signing key is ordinary self-service, unlike practiceId.
    describe('updateAccount — signingKey (a credential, not agency-gated)', () => {
        it('is written into the encrypted secrets blob, preserving the existing api_key, and never appears on the returned DTO', async () => {
            const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js');
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                secrets: encryptSecret(JSON.stringify({ api_key: 'real-api-key' })),
            });

            const result = await svc.updateAccount(ORG_A, 'acc-1', { signingKey: 'sig-key-value' });

            expect(result.signingKey).toBeUndefined();
            expect(JSON.stringify(result)).not.toContain('sig-key-value');

            const row = accountsStore.find((a) => a.id === 'acc-1');
            const decrypted = JSON.parse(decryptSecret(row.secrets));
            expect(decrypted.api_key).toBe('real-api-key'); // NOT clobbered
            expect(decrypted.signing_key).toBe('sig-key-value');
        });

        it('signingKey: null clears a previously-set key without touching api_key', async () => {
            const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js');
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                secrets: encryptSecret(JSON.stringify({ api_key: 'real-api-key', signing_key: 'old-key' })),
            });

            await svc.updateAccount(ORG_A, 'acc-1', { signingKey: null });

            const row = accountsStore.find((a) => a.id === 'acc-1');
            const decrypted = JSON.parse(decryptSecret(row.secrets));
            expect(decrypted.api_key).toBe('real-api-key');
            expect(decrypted.signing_key).toBeUndefined();
        });

        it('does NOT touch secrets on a label/practiceId-only update (signingKey key absent)', async () => {
            const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js');
            const originalSecrets = encryptSecret(JSON.stringify({ api_key: 'real-api-key', signing_key: 'untouched-key' }));
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                secrets: originalSecrets,
            });

            await svc.updateAccount(ORG_A, 'acc-1', { label: 'Ashford Dental' });

            const row = accountsStore.find((a) => a.id === 'acc-1');
            expect(row.secrets).toBe(originalSecrets);
            expect(JSON.parse(decryptSecret(row.secrets)).signing_key).toBe('untouched-key');
        });

        it("is never present on status()'s output — the field the reviewer asked to be proven absent", async () => {
            const { encryptSecret } = await import('../src/lib/crypto.js');
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                secrets: encryptSecret(JSON.stringify({ api_key: 'k', signing_key: 'super-secret-signing-key' })),
            });

            const status = await svc.status(ORG_A);

            expect(JSON.stringify(status)).not.toContain('super-secret-signing-key');
            expect(status.accounts[0]).not.toHaveProperty('signingKey');
            expect(status.accounts[0]).not.toHaveProperty('signing_key');
        });

        // FIX for "signature checking is dead code by omission": the panel
        // must be able to say HONESTLY whether a signing key is on file —
        // signingKeyConfigured is a plain (non-secret) flag for exactly that,
        // never the key itself.
        it('signingKeyConfigured flips true after a key is set, and false again after it is cleared', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford' });

            const before = await svc.status(ORG_A);
            expect(before.accounts[0].signingKeyConfigured).toBe(false);

            const afterSet = await svc.updateAccount(ORG_A, 'acc-1', { signingKey: 'a-real-signing-key' });
            expect(afterSet.signingKeyConfigured).toBe(true);

            const afterClear = await svc.updateAccount(ORG_A, 'acc-1', { signingKey: null });
            expect(afterClear.signingKeyConfigured).toBe(false);
        });
    });

    // FIX for "a rotated API key can never be replaced": before this, the
    // only advertised recovery from a key rotated at CallRail's end was
    // disconnect-and-reconnect (CallRailPanel.tsx's own banner copy). apiKey
    // is a FOURTH kind of updateAccount field — a credential like signingKey
    // (encrypted, never returned) but re-VERIFIED against CallRail first,
    // like addAccount — and NOT agency-gated, ordinary owner self-service.
    describe('updateAccount — apiKey rotation (no disconnect required)', () => {
        it('re-verifies the new key against THIS company\'s existing account/company ids before persisting, and clears a stale failure', async () => {
            const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js');
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                config: { account_id: 'ACC-1' }, status: 'failed', last_error: 'CallRail calls fetch failed: HTTP 401',
                secrets: encryptSecret(JSON.stringify({ api_key: 'stale-key' })),
            });

            const result = await svc.updateAccount(ORG_A, 'acc-1', { apiKey: 'rotated-key' });

            expect(verifyMock).toHaveBeenCalledWith('rotated-key', 'ACC-1', 'CR-1');
            expect(result.status).toBe('active');
            expect(result.lastError).toBeNull();
            expect(JSON.stringify(result)).not.toContain('rotated-key');

            const row = accountsStore.find((a) => a.id === 'acc-1');
            const decrypted = JSON.parse(decryptSecret(row.secrets));
            expect(decrypted.api_key).toBe('rotated-key');
        });

        it('rejects (400) a key CallRail does not accept, and never persists it', async () => {
            const { encryptSecret } = await import('../src/lib/crypto.js');
            const originalSecrets = encryptSecret(JSON.stringify({ api_key: 'old-key' }));
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                config: { account_id: 'ACC-1' }, secrets: originalSecrets,
            });
            verifyMock.mockRejectedValueOnce(new Error('CallRail rejected this API key for account ACC-1. Check the key and account ID and try again.'));

            await expect(svc.updateAccount(ORG_A, 'acc-1', { apiKey: 'bad-key' })).rejects.toMatchObject({ statusCode: 400 });

            const row = accountsStore.find((a) => a.id === 'acc-1');
            expect(row.secrets).toBe(originalSecrets); // untouched
        });

        it('preserves an existing signing key when rotating only the api key', async () => {
            const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js');
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                config: { account_id: 'ACC-1' },
                secrets: encryptSecret(JSON.stringify({ api_key: 'old-key', signing_key: 'keep-me' })),
            });

            await svc.updateAccount(ORG_A, 'acc-1', { apiKey: 'new-key' });

            const row = accountsStore.find((a) => a.id === 'acc-1');
            const decrypted = JSON.parse(decryptSecret(row.secrets));
            expect(decrypted.api_key).toBe('new-key');
            expect(decrypted.signing_key).toBe('keep-me');
        });

        it('rejects (400) rather than rotating against a wrong URL when the row has no CallRail account id on file', async () => {
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                config: {},
            });
            await expect(svc.updateAccount(ORG_A, 'acc-1', { apiKey: 'new-key' })).rejects.toMatchObject({ statusCode: 400 });
            expect(verifyMock).not.toHaveBeenCalled();
        });

        it('rejects an empty apiKey rather than silently no-op-ing', async () => {
            seedAccount({
                organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford',
                config: { account_id: 'ACC-1' },
            });
            await expect(svc.updateAccount(ORG_A, 'acc-1', { apiKey: '   ' })).rejects.toMatchObject({ statusCode: 400 });
            expect(verifyMock).not.toHaveBeenCalled();
        });
    });

    describe('removeAccount — disconnecting a company must not delete its calls', () => {
        it('soft-revokes the company (status + secrets nulled) without ever touching callrail_calls', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', practice_id: 'practice-1' });
            const out = await svc.removeAccount(ORG_A, 'acc-1');
            expect(out).toEqual({ removed: true });

            const row = accountsStore.find((a) => a.id === 'acc-1');
            expect(row.status).toBe('revoked');
            expect(row.secrets).toBeNull();

            // callrail.repository.js's only write methods are upsertCalls and
            // restampPractice — asserting neither ran proves a call outlives
            // the company that fetched it (migration 000154's ON DELETE SET
            // NULL is what makes this safe even if the row were hard-deleted
            // later): its practice_id is left exactly as it was.
            expect(callrailRepoMock.restampPractice).not.toHaveBeenCalled();
            expect(callrailRepoMock.upsertCalls).not.toHaveBeenCalled();
        });

        it('404s for an unknown or cross-org account id', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford' });
            await expect(svc.removeAccount(ORG_B, 'acc-1')).rejects.toThrow(/not found/i);
        });
    });

    // FIX for "opts.full is dead code": a manual per-company sync is exactly
    // the moment a wide catch-up is worth it, so this always passes
    // { full: true } — previously unreachable, since nothing ever passed it.
    describe('syncAccount — delegates to callrail-sync.js\'s real pull, always FULL', () => {
        it('resolves the FULL account (secrets included) and passes it to the pull with opts.full:true, returning ingested AND truncated', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', secrets: 'enc:api-key' });
            pullMock.mockResolvedValueOnce({ ingested: 7, fetched: 7, requests: 1, truncated: true });

            const result = await svc.syncAccount(ORG_A, 'acc-1');

            // FIX for "truncated is silently dropped": it now reaches the
            // panel instead of being clamped away between the pull and the
            // controller response.
            expect(result).toEqual({ ingested: 7, truncated: true });
            expect(pullMock).toHaveBeenCalledTimes(1);
            const [passedOrg, passedAccount, , passedOpts] = pullMock.mock.calls[0];
            expect(passedOrg).toBe(ORG_A);
            expect(passedAccount).toMatchObject({ id: 'acc-1', secrets: 'enc:api-key' }); // the FULL row, not the SAFE_COLS shape getById returns
            expect(passedOpts).toEqual({ full: true });
        });

        it('defaults truncated to false when the pull omits it', async () => {
            seedAccount({ organisation_id: ORG_A, id: 'acc-1', external_account_id: 'CR-1', webhook_token: 'tok-1', label: 'Ashford', secrets: 'enc:api-key' });
            pullMock.mockResolvedValueOnce({ ingested: 3 });
            const result = await svc.syncAccount(ORG_A, 'acc-1');
            expect(result).toEqual({ ingested: 3, truncated: false });
        });

        it('404s for an unknown company rather than silently no-op-ing, and never calls the pull', async () => {
            await expect(svc.syncAccount(ORG_A, 'nope')).rejects.toThrow(/not found/i);
            expect(pullMock).not.toHaveBeenCalled();
        });
    });
});

// ============================================================================
// Layer 3 — integrationController's CallRail account handlers: the
// practiceId agency-actor guard, and that org id always comes from the
// session, never the request body.
// ============================================================================
describe('integrationController — CallRail accounts', () => {
    let controller;
    let serviceMock;

    function mockRes() {
        const res = {};
        res.status = vi.fn(() => res);
        res.json = vi.fn(() => res);
        return res;
    }

    const ID = '11111111-1111-4111-8111-111111111111';

    beforeEach(async () => {
        vi.resetModules();
        serviceMock = {
            discoverAccounts: vi.fn(async () => ({ accounts: [{ accountId: 'ACC-1', accountName: 'Account', companies: [{ id: 'CR-1', name: 'Ashford', alreadyConnected: false }] }] })),
            bulkConnect: vi.fn(async (orgId, body) => ({ results: (body.companies ?? []).map((c) => ({ companyId: c.companyId, ok: true, account: { id: 'acc-1', ...c } })) })),
            addAccount: vi.fn(async (orgId, body) => ({ id: 'acc-1', ...body })),
            updateAccount: vi.fn(async (orgId, id, body) => ({ id, ...body })),
            removeAccount: vi.fn(async () => ({ removed: true })),
            syncAccount: vi.fn(async () => ({ ingested: 0, truncated: false })),
            status: vi.fn(async () => ({ connected: false, accounts: [], sourceBreakdown: [] })),
        };
        vi.doMock('../src/services/callrail.service.js', () => ({ callrailService: serviceMock }));
        controller = (await import('../src/controllers/integration.controller.js')).integrationController;
    });

    it('callrailGet reads status via callrailService, using the session org id', async () => {
        const res = mockRes();
        await controller.callrailGet({ user: { organisation_id: 'org-real' }, query: { organisation_id: 'org-spoofed' }, body: {} }, res);
        expect(serviceMock.status).toHaveBeenCalledWith('org-real');
        expect(res.json).toHaveBeenCalledWith({ connected: false, accounts: [], sourceBreakdown: [] });
    });

    it('callrailDiscover passes the session org id and body through, using the service response as-is', async () => {
        const res = mockRes();
        await controller.callrailDiscover({
            user: { organisation_id: 'org-real' },
            body: { apiKey: 'k' },
        }, res);
        expect(serviceMock.discoverAccounts).toHaveBeenCalledWith('org-real', { apiKey: 'k' });
        expect(res.json).toHaveBeenCalledWith({ accounts: [{ accountId: 'ACC-1', accountName: 'Account', companies: [{ id: 'CR-1', name: 'Ashford', alreadyConnected: false }] }] });
    });

    it('callrailBulkConnect: a non-agency owner sending a practiceId on ANY entry is rejected with 403, and the service is never called', async () => {
        const res = mockRes();
        await controller.callrailBulkConnect({
            user: { organisation_id: 'org-1', is_agency_admin: false },
            body: { apiKey: 'k', companies: [{ accountId: 'ACC-1', companyId: 'CR-1' }, { accountId: 'ACC-1', companyId: 'CR-2', practiceId: 'practice-1' }] },
        }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(serviceMock.bulkConnect).not.toHaveBeenCalled();
    });

    it('callrailBulkConnect: a non-agency owner may still connect companies when NO entry carries practiceId', async () => {
        const res = mockRes();
        await controller.callrailBulkConnect({
            user: { organisation_id: 'org-1', is_agency_admin: false },
            body: { apiKey: 'k', companies: [{ accountId: 'ACC-1', companyId: 'CR-1' }] },
        }, res);
        expect(serviceMock.bulkConnect).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('callrailBulkConnect: an agency actor may set practiceId per entry, and the session org id is used, never the body', async () => {
        const res = mockRes();
        await controller.callrailBulkConnect({
            user: { organisation_id: 'org-real', is_agency_admin: true },
            body: {
                apiKey: 'k',
                organisation_id: 'org-spoofed',
                companies: [{ accountId: 'ACC-1', companyId: 'CR-1', practiceId: '22222222-2222-4222-8222-222222222222' }],
            },
        }, res);
        expect(serviceMock.bulkConnect).toHaveBeenCalledWith('org-real', expect.objectContaining({
            apiKey: 'k',
            companies: [expect.objectContaining({ practiceId: '22222222-2222-4222-8222-222222222222' })],
        }));
    });

    it('callrailAccountCreate: a non-agency owner sending a practiceId is rejected with 403, and the service is never called', async () => {
        const res = mockRes();
        await controller.callrailAccountCreate({
            user: { organisation_id: 'org-1', is_agency_admin: false },
            body: { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford', practiceId: 'practice-1' },
        }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(serviceMock.addAccount).not.toHaveBeenCalled();
    });

    it('callrailAccountCreate: an agency actor may set practiceId', async () => {
        const res = mockRes();
        await controller.callrailAccountCreate({
            user: { organisation_id: 'org-1', is_agency_admin: true },
            body: { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford', practiceId: '22222222-2222-4222-8222-222222222222' },
        }, res);
        expect(serviceMock.addAccount).toHaveBeenCalledWith('org-1', expect.objectContaining({ practiceId: '22222222-2222-4222-8222-222222222222' }));
    });

    it('callrailAccountCreate: a non-agency owner may still add an unmapped company (practiceId key entirely absent)', async () => {
        const res = mockRes();
        await controller.callrailAccountCreate({
            user: { organisation_id: 'org-1', is_agency_admin: false },
            body: { apiKey: 'k', callrailAccountId: 'ACC-1', callrailCompanyId: 'CR-1', label: 'Ashford' },
        }, res);
        expect(serviceMock.addAccount).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('callrailAccountUpdate: a non-agency owner sending a practiceId is rejected with 403', async () => {
        const res = mockRes();
        await controller.callrailAccountUpdate({
            user: { organisation_id: 'org-1', is_agency_admin: false },
            params: { id: ID },
            body: { practiceId: '22222222-2222-4222-8222-222222222222' },
        }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(serviceMock.updateAccount).not.toHaveBeenCalled();
    });

    it('callrailAccountUpdate: a non-agency owner may still change the label', async () => {
        const res = mockRes();
        await controller.callrailAccountUpdate({
            user: { organisation_id: 'org-1', is_agency_admin: false },
            params: { id: ID },
            body: { label: 'New label' },
        }, res);
        expect(serviceMock.updateAccount).toHaveBeenCalledWith('org-1', ID, { label: 'New label' });
    });

    it('callrailAccountRemove and callrailAccountSync use the session org id, ignoring a spoofed body', async () => {
        const res = mockRes();
        await controller.callrailAccountRemove({
            user: { organisation_id: 'org-real' },
            params: { id: ID },
            body: { organisation_id: 'org-spoofed' },
        }, res);
        expect(serviceMock.removeAccount).toHaveBeenCalledWith('org-real', ID);

        await controller.callrailAccountSync({
            user: { organisation_id: 'org-real' },
            params: { id: ID },
            body: { organisation_id: 'org-spoofed' },
        }, res);
        expect(serviceMock.syncAccount).toHaveBeenCalledWith('org-real', ID);
    });
});
