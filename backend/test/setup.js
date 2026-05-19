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
      single: () => settle(),
      then: (resolve, reject) => settle().then(resolve, reject),
    };
    return builder;
  }

  function makeClient() {
    return {
      from: makeFrom,
      auth: {
        getUser: async () =>
          supaRec.authUser
            ? { data: { user: supaRec.authUser }, error: null }
            : { data: { user: null }, error: { message: 'no user' } },
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
