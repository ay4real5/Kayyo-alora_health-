import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running dashboard (http://localhost:3000) and API with the demo seed loaded
 * (`npm run db:seed -w @alora/api`). Start both first; see README. Wired into CI in P1-22.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
