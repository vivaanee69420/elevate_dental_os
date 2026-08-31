import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.{js,mjs}'],
    setupFiles: ['./test/setup.js'],
    // Runs in the main process before workers fork, so every fork inherits the
    // dummy env at OS level before any module-load env capture (see file).
    globalSetup: ['./test/global-setup.js'],
    // A handful of suites legitimately run 2.5-3.5s (AI context assembly, the
    // sync retry paths). Against vitest's 5s default they tipped over whenever
    // parallel workers contended for CPU, so the suite failed a DIFFERENT
    // random test most runs — noise that trains you to ignore red. A generous
    // ceiling still fails a genuinely hung test, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    clearMocks: true,
    // Dummy Supabase/secret env set BEFORE any test module imports, so a file
    // that imports lib/supabase.js at module-eval can't lose a race with
    // setup.js under parallel workers. setup.js still uses `||=` so real env
    // (and per-test overrides) take precedence.
    env: {
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_ANON_KEY: 'test-anon-key',
      INTEGRATIONS_SECRET_KEY: 'test-integrations-key',
      OAUTH_STATE_SECRET: 'test-state-secret',
    },
  },
});
