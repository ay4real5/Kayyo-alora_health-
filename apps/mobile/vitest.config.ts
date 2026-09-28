import { defineConfig } from 'vitest/config';

// Unit tests for plain TypeScript logic (session, API client). Screens are checked by the type checker.
export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
});
