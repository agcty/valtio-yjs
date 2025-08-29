/// <reference types="vitest" />

import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    browser: {
      provider: "playwright",
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
    },
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    // setupFiles: ['./tests/vitest-setup.ts'],
  },
});
