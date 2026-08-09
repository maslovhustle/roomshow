import { defineConfig, devices } from '@playwright/test';

// Tests run against the production build, not the dev server: hashed asset
// names and the Vite build pipeline are part of what ships, and a preview that
// only ever runs unbundled code would not catch a broken build.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Every stage page drives a full WebGL loop through SwiftShader, so these are
  // far heavier than typical DOM tests. Left unbounded, parallel workers starve
  // each other and pages die mid-assertion.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    // A small buffer at scale factor 1 keeps software rendering affordable; the
    // shader is being checked for correctness, not for resolution.
    viewport: { width: 800, height: 450 },
    deviceScaleFactor: 1,
    // WebGL needs a real GPU path; headless Chromium falls back to SwiftShader,
    // which is slow but correct, and the stage is unverifiable without it.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // Playwright ships no Chromium build for macOS 12, so a developer on one
      // drives their installed Chrome instead. CI is Linux and uses the pinned
      // bundled browser, which is the one the results should be trusted from.
      ...(process.env.CI ? {} : { channel: 'chrome' as const }),
    },
  }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
