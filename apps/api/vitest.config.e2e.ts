import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// DB-backed e2e tests use the repo-root .env locally (CI sets DATABASE_URL itself; existing vars win).
config({ path: '../../.env', quiet: true });
// Background jobs would change test data mid-test (e.g. mark yesterday's test visits missed). Tests call them directly.
process.env.JOBS_ENABLED = 'false';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    // Decorators (class-validator/transformer, Nest DI) need the Reflect metadata API, as in the real app.
    setupFiles: ['reflect-metadata'],
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // These hit a real (often remote) database: run files one at a time, and allow for network latency.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
