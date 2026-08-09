import { defineConfig } from 'vitest/config';

// Playwright owns tests/e2e and drives a real browser; Vitest must not try to
// collect those or it fails on the @playwright/test import.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    restoreMocks: true,
  },
});
