/**
 * Creates a real agency and its first administrator — the way to start a production (or staging) database, where
 * the demo seed must never run (D-081).
 *
 *   DATABASE_URL=... npm run agency:create -w @alora/api -- --name "Sunrise Home Health" \
 *     --email owner@sunrise.example --first Ada --last Owner [--timezone America/New_York] [--state VA] [--invite]
 *
 * Prints a one-time temporary password: the admin must choose their own at first sign-in, then set up two-factor
 * authentication (both enforced by the API). Refuses if the email already has an account.
 *
 * With --invite (used by the "Create agency" workflow, D-084) nothing secret is printed: the admin is emailed a
 * one-time "choose your password" link (INVITE_LINK_HOURS) through the same email settings as the API
 * (EMAIL_PROVIDER, EMAIL_FROM, provider credentials, FRONTEND_URL).
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import type { EnvironmentVariables } from '../config/env.validation.js';
import type { PrismaService } from '../database/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { EmailSender } from '../modules/notifications/delivery/senders.js';
import { RbacSyncService } from '../modules/rbac/rbac-sync.service.js';
import { INVITE_LINK_HOURS, hashToken, inviteEmail, inviteLink, maskEmail } from './agency-invite.js';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    first: { type: 'string' },
    last: { type: 'string' },
    timezone: { type: 'string', default: 'America/New_York' },
    state: { type: 'string', default: 'VA' },
    invite: { type: 'boolean', default: false },
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

const invite = values.invite === true;
const env = (name: string) => process.env[name]?.trim() || undefined;
const frontendUrl = env('FRONTEND_URL');
let emailSender: EmailSender | null = null;
if (invite) {
  // The same sender and settings as the API; only what email needs is passed in.
  const settings = {
    EMAIL_PROVIDER: env('EMAIL_PROVIDER')?.toLowerCase(),
    EMAIL_FROM: env('EMAIL_FROM'),
    AZURE_COMMUNICATION_CONNECTION_STRING: env('AZURE_COMMUNICATION_CONNECTION_STRING'),
    AWS_REGION: env('AWS_REGION'),
    SENDGRID_API_KEY: env('SENDGRID_API_KEY'),
    SENDGRID_FROM_EMAIL: env('SENDGRID_FROM_EMAIL'),
    FRONTEND_URL: frontendUrl,
  };
  emailSender = new EmailSender(new ConfigService(settings) as unknown as ConfigService<EnvironmentVariables, true>);
  if (!frontendUrl || !emailSender.enabled) {
    console.error('--invite needs FRONTEND_URL and working email settings (EMAIL_PROVIDER, EMAIL_FROM, provider credentials)');
    process.exit(1);
  }
}

/** 20 random characters plus one of each class the password policy needs. With --invite nobody ever sees it. */
const temporaryPassword = `${randomBytes(15).toString('base64url')}Aa7!`;
const email = values.email!.trim().toLowerCase();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

try {
  if (await prisma.user.findUnique({ where: { email } })) throw new Error(`${invite ? maskEmail(email) : email} already has an account`);
  await new RbacSyncService(prisma as unknown as PrismaService).sync();
  const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: 'agency_admin' } });
  const token = randomBytes(32).toString('base64url');
  const agency = await prisma.$transaction(async (tx) => {
    const created = await tx.agency.create({
      data: { name: values.name!.trim(), timezone: values.timezone!, state: values.state!.trim().toUpperCase().slice(0, 2) },
    });
    const user = await tx.user.create({
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
    if (invite) {
      // Works like a password reset link (same table, same page), just valid for longer.
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_LINK_HOURS * 3_600_000) },
      });
    }
    return created;
  });
  console.log(`\nAgency created: ${agency.name} (${agency.id})`);
  if (invite) {
    const { subject, text } = inviteEmail(agency.name, values.first!.trim(), inviteLink(frontendUrl!, token));
    const sent = await emailSender!.sendText(email, subject, text);
    if (sent.ok) {
      console.log(`Administrator: ${maskEmail(email)} — invite emailed (link valid ${INVITE_LINK_HOURS} hours).`);
      console.log('They choose a password from the email, then set up two-factor authentication.\n');
    } else {
      console.error(`Administrator ${maskEmail(email)} was created, but the invite email failed (${sent.error}).`);
      console.error('They can use "Forgot password" on the sign-in page to get a new link.');
      process.exitCode = 2;
    }
  } else {
    console.log(`Administrator: ${email}`);
    console.log(`Temporary password (shown once — give it privately): ${temporaryPassword}`);
    console.log('At first sign-in they choose a new password, then set up two-factor authentication.\n');
  }
} finally {
  await prisma.$disconnect();
}
