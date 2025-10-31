/// <reference types="vitest" />
/// <reference types="@vitest/browser/matchers" />

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      provider: playwright(),
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
    },
    include: ["src/**/*.test.ts", "tests/**/*.spec.{ts,tsx}"],
  },
});
