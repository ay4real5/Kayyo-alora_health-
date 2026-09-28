/**
 * `npm run db:seed -w @alora/api` (after `npm run build`). Wipes and rebuilds the FAKE demo agency and prints
 * its logins. Refuses to run when APP_ENV=production. See demo-seed.ts and DECISIONS D-033.
 */
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { encryptPhi, encryptPhiBytes } from '../common/crypto/phi-crypto.js';
import { buildPhiKeyring } from '../common/crypto/phi-keyring.js';
import { PhiContext } from '../common/crypto/phi-crypto.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { messageContentContext } from '../modules/messaging/message-content.js';
import { RbacSyncService } from '../modules/rbac/rbac-sync.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import { DEMO_TOTP_SECRET, runDemoSeed } from './demo-seed.js';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const keyring = buildPhiKeyring({
  PHI_ENCRYPTION_KEY: process.env.PHI_ENCRYPTION_KEY,
  PHI_ENCRYPTION_KEY_VERSION: Number(process.env.PHI_ENCRYPTION_KEY_VERSION ?? 1),
  PHI_ENCRYPTION_PREVIOUS_KEYS: process.env.PHI_ENCRYPTION_PREVIOUS_KEYS,
});

try {
  const summary = await runDemoSeed(prisma, {
    appEnv: process.env.APP_ENV,
    password: process.env.DEMO_PASSWORD,
    syncRoles: () => new RbacSyncService(prisma as unknown as PrismaService).sync(),
    encryptTwoFaSecret: keyring
      ? (base32) => Buffer.from(encryptPhi(base32, PhiContext.UserTwoFaSecret, keyring)).toString('base64')
      : undefined,
    encryptMessage: keyring
      ? (text, messageId) => new Uint8Array(encryptPhiBytes(Buffer.from(text, 'utf8'), messageContentContext(messageId), keyring))
      : undefined,
    encryptSsn: keyring
      ? (ssn, kind) =>
          new Uint8Array(encryptPhi(ssn, kind === 'patient' ? PhiContext.PatientSsn : PhiContext.StaffSsn, keyring))
      : undefined,
  });
  console.log('\nDemo agency seeded (all data is FAKE).\n');
  console.table(summary.counts);
  console.log(`Password for every demo login: ${summary.password}\n`);
  console.table(summary.logins);
  if (keyring) console.log(`Admins use two-factor authentication. Authenticator key (demo only): ${DEMO_TOTP_SECRET}
`);
} finally {
  await prisma.$disconnect();
}
