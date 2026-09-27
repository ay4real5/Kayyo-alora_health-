import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Resets the FAKE demo agency before the browser tests, so counts (e.g. 27 active patients) are known.
 * Needs a built API (`npm run build`). Set SKIP_SEED=1 to reuse the current data.
 */
export default function globalSetup(): void {
  if (process.env.SKIP_SEED === '1') return;
  execSync('npm run db:seed -w @alora/api', {
    cwd: resolve(__dirname, '../../..'),
    stdio: 'ignore',
    timeout: 180_000,
  });
}
