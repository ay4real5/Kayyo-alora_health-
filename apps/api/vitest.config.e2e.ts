import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// DB-backed e2e tests use the repo-root .env locally (CI sets DATABASE_URL itself; existing vars win).
config({ path: '../../.env', quiet: true });

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
