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
// Collapse the GoHighLevel retry backoff so tests that exercise the retry path
// don't spend ~17s sleeping through real exponential waits.
process.env.GHL_RETRY_BASE_MS ||= '1';
process.env.OAUTH_STATE_SECRET ||= 'test-state-secret';
// Messaging clients (postmark/twilio) construct at module import; give them
// non-empty dummy creds so importing any service that pulls in lib/messaging.js
// doesn't throw. No network is hit at construction. Twilio SID must start 'AC'.
process.env.POSTMARK_SERVER_TOKEN ||= 'test-postmark-token';
process.env.TWILIO_ACCOUNT_SID ||= 'ACtest00000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN ||= 'test-twilio-token';

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
    // Honour .range() the way a real server does: return only that window of
    // the provider's rows. Without this a paged repository re-reads the SAME
    // rows on every iteration — it never reaches the empty page that ends the
    // loop. Providers that return less than one page (the overwhelming
    // majority) are unaffected: slice() hands their data back unchanged.
    const settle = () => Promise.resolve(supaRec.resultProvider(q)).then((res) => {
      if (!q.range || !Array.isArray(res?.data)) return res;
      return { ...res, data: res.data.slice(q.range.from, q.range.to + 1) };
    });
    const builder = {
      select(...a) {
        q.op = 'select';
        q.selectArgs = a;
        q.select = a[0];
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
        // Return the builder (like insert) so both terminal `await upsert(v)`
        // (via .then) and chained `upsert(v).select().single()` work.
        return builder;
      },
      eq(col, val) {
        q.eqs.push({ col, val });
        return builder;
      },
      neq(col, val) {
        (q.neqs ||= []).push({ col, val });
        return builder;
      },
      // Additive chainables (backward-compatible: existing tests only read
      // q.table/q.op/q.eqs/q.upsertVals). Recorded for assertions; the
      // analytics repo uses .limit() and .maybeSingle().
      gte(col, val) {
        (q.gtes ||= []).push({ col, val });
        return builder;
      },
      gt(col, val) {
        (q.gts ||= []).push({ col, val });
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
        (q.orders ||= []).push({ col, opts });
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
        return builder;
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
      is(col, val) {
        (q.iss ||= []).push({ col, val });
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
      // specific RPC outcome set supaRec.rpcProvider(fn, params, mods).
      //
      // Returns a THENABLE BUILDER, not a promise: PostgREST exposes a
      // set-returning function as a relation, so a caller may chain .order()
      // and .range() onto it to page past the 1000-row cap. `await
      // client.rpc(...)` still works unchanged because the builder is
      // thenable. `mods` carries { order, range } so a provider can serve a
      // specific page.
      rpc: (fn, params) => {
        // `mods` is attached to the record only once a modifier is actually
        // used, so the many existing `toEqual({ fn, params })` assertions on
        // unmodified RPC calls keep passing.
        const call = { fn, params };
        (supaRec.rpcCalls ||= []).push(call);
        const settle = async () =>
          supaRec.rpcProvider
            ? supaRec.rpcProvider(fn, params, call.mods ?? {})
            : { data: null, error: { message: `rpc ${fn} not stubbed` } };
        const builder = {
          order(col, opts) {
            // `mods.order` keeps its old single-value shape (last .order()
            // call wins) so existing `toEqual({ col, opts })` assertions
            // keep passing. `mods.orders` accumulates every call in
            // sequence, for callers (like campaignFunnel) that chain
            // multiple .order() calls to sort by a composite key.
            (call.mods ||= {}).order = { col, opts };
            (call.mods.orders ||= []).push({ col, opts });
            return builder;
          },
          range(from, to) {
            (call.mods ||= {}).range = { from, to };
            return builder;
          },
          then: (resolve, reject) => settle().then(resolve, reject),
        };
        return builder;
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
