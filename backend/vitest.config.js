import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.{js,mjs}'],
    setupFiles: ['./test/setup.js'],
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
