// ============================================================================
// Test bootstrap (native ESM).
//
// 1. Dummy Supabase env vars so lib/supabase.js's import-time guard passes.
// 2. vi.mock('@supabase/supabase-js') with a recording fake so lib/supabase.js
//    (ESM `import { createClient }`) gets the stub. NEVER hits network/DB.
//
// `supaRec` is the shared recorder/controller: tests set
// supaRec.resultProvider(query) and read supaRec.last (the last query: its
// table, op, and the full chain of .eq() filters) to assert org-scoping.
// Defined via vi.hoisted so the vi.mock factory and the `supaRec` export
// share the same instance.
// ============================================================================
import { vi } from 'vitest';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
// lib/crypto.js captures the key at module load, so it must be set before any
// test imports it. lib/oauth-state.js reads its secret per-call (set here too
// for convenience; individual tests may override).
process.env.INTEGRATIONS_SECRET_KEY ||= 'test-integrations-key';
process.env.OAUTH_STATE_SECRET ||= 'test-state-secret';

const h = vi.hoisted(() => {
  const supaRec = {
    last: undefined,
    // Default: an empty successful result. Tests override per-case.
    resultProvider: () => ({ data: [], error: null }),
    // Set by tests that need auth.getUser to resolve a specific user.
    authUser: null,
  };

  function makeFrom(table) {
    const q = { table, eqs: [], op: 'select' };
    supaRec.last = q;
    const settle = () => Promise.resolve(supaRec.resultProvider(q));
    const builder = {
      select(...a) {
        q.op = 'select';
        q.selectArgs = a;
        return builder;
      },
      update(vals) {
        q.op = 'update';
        q.updateVals = vals;
        return builder;
      },
      insert(vals) {
        q.op = 'insert';
        q.insertVals = vals;
        // Return the builder (not a settled promise) so both terminal
        // `await from(t).insert(v)` (via .then) and chained
        // `from(t).insert(v).select().single()` (createOrganisation) work.
        return builder;
      },
      delete() {
        q.op = 'delete';
        return builder;
      },
      upsert(vals, opts) {
        q.op = 'upsert';
        q.upsertVals = vals;
        q.upsertOpts = opts;
        return settle();
      },
      eq(col, val) {
        q.eqs.push({ col, val });
        return builder;
      },
      // Additive chainables (backward-compatible: existing tests only read
      // q.table/q.op/q.eqs/q.upsertVals). Recorded for assertions; the
      // analytics repo uses .limit() and .maybeSingle().
      gte(col, val) {
        (q.gtes ||= []).push({ col, val });
        return builder;
      },
      lte(col, val) {
        (q.ltes ||= []).push({ col, val });
        return builder;
      },
      lt(col, val) {
        (q.lts ||= []).push({ col, val });
        return builder;
      },
      order(col, opts) {
        q.order = { col, opts };
        return builder;
      },
      in(col, vals) {
        (q.ins ||= []).push({ col, vals });
        return builder;
      },
      limit(n) {
        q.limitN = n;
        return builder;
      },
      range(from, to) {
        q.range = { from, to };
        return settle();
      },
      ilike(col, val) {
        (q.ilikes ||= []).push({ col, val });
        return builder;
      },
      or(expr) {
        (q.ors ||= []).push(expr);
        return builder;
      },
      not(col, op, val) {
        (q.nots ||= []).push({ col, op, val });
        return builder;
      },
      maybeSingle: () => settle(),
      single: () => settle(),
      then: (resolve, reject) => settle().then(resolve, reject),
    };
    return builder;
  }

  // GoTrue admin / auth recorder. Tests read supaRec.adminCalls (ordered
  // [{ m, args }]) and override outcomes via supaRec.adminProvider(m, args).
  function admin(m) {
    return async (...args) => {
      (supaRec.adminCalls ||= []).push({ m, args });
      return supaRec.adminProvider
        ? supaRec.adminProvider(m, args)
        : { data: { user: { id: 'auth-new' } }, error: null };
    };
  }

  function makeClient() {
    return {
      from: makeFrom,
      // RPC recorder. Default returns an ERROR result so callers that treat
      // RPC as optional (auth middleware's auth_bootstrap fast path) fall back
      // to their query path, matching pre-RPC behaviour. Tests that want a
      // specific RPC outcome set supaRec.rpcProvider(fn, params).
      rpc: async (fn, params) => {
        (supaRec.rpcCalls ||= []).push({ fn, params });
        return supaRec.rpcProvider
          ? supaRec.rpcProvider(fn, params)
          : { data: null, error: { message: `rpc ${fn} not stubbed` } };
      },
      auth: {
        getUser: async () =>
          supaRec.authUser
            ? { data: { user: supaRec.authUser }, error: null }
            : { data: { user: null }, error: { message: 'no user' } },
        signInWithPassword: admin('signInWithPassword'),
        admin: {
          createUser: admin('createUser'),
          inviteUserByEmail: admin('inviteUserByEmail'),
          updateUserById: admin('updateUserById'),
          deleteUser: admin('deleteUser'),
          listUsers: admin('listUsers'),
        },
      },
    };
  }

  return { supaRec, makeClient };
});

// Intercept the ESM import in lib/supabase.js (`import * as ... from
// "@supabase/supabase-js"` -> `.createClient`).
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => h.makeClient(),
}));

export const supaRec = h.supaRec;
