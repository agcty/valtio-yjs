/// <reference types="vitest" />

import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    browser: {
      provider: "playwright",
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
    },
    include: [
      'src/**/*.test.ts',                      // Co-located unit tests
      'tests/integration/**/*.spec.ts',        // Integration tests
      'tests/e2e/**/*.spec.ts',                // End-to-end tests
      'tests/investigation/**/*.spec.ts'       // Investigation/analysis tests
    ],
    setupFiles: ['./tests/helpers/vitest-setup.ts'],
  },
});
