import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running dashboard (http://localhost:3000) and API. The demo agency is re-seeded first
 * (global-setup.ts; SKIP_SEED=1 to skip). Start API + dashboard first; see README. Wired into CI in P1-22.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
