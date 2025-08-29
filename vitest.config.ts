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
    setupFiles: ['./tests/vitest-setup.ts'],
  },
});
