'use strict';
const { defineConfig } = require('vitest/config');
module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.{js,mjs}'],
    setupFiles: ['./test/setup.js'],
    clearMocks: true,
  },
});
