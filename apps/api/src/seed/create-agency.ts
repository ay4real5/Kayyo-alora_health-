/**
 * Creates a real agency and its first administrator — the way to start a production (or staging) database, where
 * the demo seed must never run (D-081).
 *
 *   DATABASE_URL=... npm run agency:create -w @alora/api -- --name "Sunrise Home Health" \
 *     --email owner@sunrise.example --first Ada --last Owner [--timezone America/New_York] [--state VA]
 *
 * Prints a one-time temporary password: the admin must choose their own at first sign-in, then set up two-factor
 * authentication (both enforced by the API). Refuses if the email already has an account.
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client.js';
import { RbacSyncService } from '../modules/rbac/rbac-sync.service.js';
import type { PrismaService } from '../database/prisma.service.js';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    first: { type: 'string' },
    last: { type: 'string' },
    timezone: { type: 'string', default: 'America/New_York' },
    state: { type: 'string', default: 'VA' },
  },
});
const missing = (['name', 'email', 'first', 'last'] as const).filter((k) => !values[k]?.trim());
if (missing.length) {
  console.error(`Missing: ${missing.map((k) => `--${k}`).join(', ')}`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
try {
  new Intl.DateTimeFormat('en-US', { timeZone: values.timezone });
} catch {
  throw new Error(`Unknown time zone: ${values.timezone}`);
}

/** 20 random characters plus one of each class the password policy needs. */
const temporaryPassword = `${randomBytes(15).toString('base64url')}Aa7!`;
const email = values.email!.trim().toLowerCase();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

try {
  if (await prisma.user.findUnique({ where: { email } })) throw new Error(`${email} already has an account`);
  await new RbacSyncService(prisma as unknown as PrismaService).sync();
  const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'agency_admin' } });
  const agency = await prisma.$transaction(async (tx) => {
    const created = await tx.agency.create({
      data: { name: values.name!.trim(), timezone: values.timezone!, state: values.state!.trim().toUpperCase().slice(0, 2) },
    });
    await tx.user.create({
      data: {
        agencyId: created.id,
        email,
        passwordHash: await hash(temporaryPassword),
        passwordChangedAt: null, // forces a new password at first sign-in
        firstName: values.first!.trim(),
        lastName: values.last!.trim(),
        userRoles: { create: { roleId: role.id } },
      },
    });
    return created;
  });
  console.log(`\nAgency created: ${agency.name} (${agency.id})`);
  console.log(`Administrator: ${email}`);
  console.log(`Temporary password (shown once — give it privately): ${temporaryPassword}`);
  console.log('At first sign-in they choose a new password, then set up two-factor authentication.\n');
} finally {
  await prisma.$disconnect();
}
