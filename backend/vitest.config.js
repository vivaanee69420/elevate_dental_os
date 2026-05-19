import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.{js,mjs}'],
    setupFiles: ['./test/setup.js'],
    clearMocks: true,
  },
});
