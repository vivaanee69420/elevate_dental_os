// Runs ONCE in the vitest main process before any worker fork is spawned, so
// every forked worker inherits these env vars at OS level — before any test
// module (e.g. lib/supabase.js, lib/crypto.js) is imported and captures them.
// This removes a parallel-scheduling race where setupFiles/test.env could lose
// to a module that reads env at import time. `||=` so real env still wins.
export default function () {
  process.env.SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
  process.env.INTEGRATIONS_SECRET_KEY ||= 'test-integrations-key';
  process.env.OAUTH_STATE_SECRET ||= 'test-state-secret';
}
