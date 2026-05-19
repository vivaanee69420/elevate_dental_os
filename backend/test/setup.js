'use strict';

// ============================================================================
// Test bootstrap.
//
// 1. Dummy Supabase env vars so lib/supabase.js's import-time guard passes.
// 2. A real fake of @supabase/supabase-js installed into Node's require
//    cache BEFORE any source module is loaded. The committed backend source
//    is compiled CommonJS that does require("@supabase/supabase-js") at
//    import time and constructs serviceClient eagerly — vitest's ESM mocker
//    does not rewrite those nested CJS requires, so we stub at the module
//    cache. NEVER hits a real network/DB.
//
// `supaRec` is the shared recorder/controller: tests set
// supaRec.resultProvider(query) and read supaRec.last (the last query: its
// table, op, and the full chain of .eq() filters) to assert org-scoping.
// ============================================================================

const Module = require('node:module');

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

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

const fakeSupabase = { createClient: () => makeClient() };

// Install into the require cache so every require("@supabase/supabase-js")
// (including the eager one inside compiled-CJS lib/supabase.js) gets this.
const resolved = require.resolve('@supabase/supabase-js');
require.cache[resolved] = {
  id: resolved,
  filename: resolved,
  loaded: true,
  exports: fakeSupabase,
};

// Belt-and-braces: also intercept resolution itself in case the cache key
// differs under vitest's loader.
const origLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '@supabase/supabase-js') return fakeSupabase;
  return origLoad.call(this, request, parent, isMain);
};

module.exports = { supaRec };
