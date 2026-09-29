import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryChannel } from '@alora/shared';
import { PrismaService } from '../../../database/prisma.service.js';
import { DELIVERY_MAX_AGE_HOURS, MAX_ATTEMPTS, RETRY_DELAYS_MINUTES } from './delivery-plan.js';
import { EmailSender, PushSender, SmsSender, toE164, type DeliveryMessage, type SendOutcome } from './senders.js';

const BATCH = 50;
/** A row left in "sending" this long (the instance died mid-send) is taken again. */
const STALE_CLAIM_MINUTES = 10;

export interface DeliveryRunResult {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

/**
 * Sends the delivery outbox (D-071): rows `notify()` queued for push / SMS / email. Several API instances can run it
 * at once — each takes rows with `FOR UPDATE SKIP LOCKED`. Failures retry with backoff, then give up; nothing about
 * the message or the person is logged.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    readonly push: PushSender,
    readonly sms: SmsSender,
    readonly email: EmailSender,
  ) {}

  /** Channels whose provider settings are present. */
  available(): Record<DeliveryChannel, boolean> {
    return { push: this.push.enabled, sms: this.sms.enabled, email: this.email.enabled };
  }

  async run(now = new Date()): Promise<DeliveryRunResult> {
    const result: DeliveryRunResult = { sent: 0, retried: 0, failed: 0, skipped: 0 };
    const stale = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
    await this.prisma.notificationDelivery.updateMany({
      where: { status: 'sending', claimedAt: { lt: stale } },
      data: { status: 'pending' },
    });
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE notification_deliveries SET status = 'sending', claimed_at = ${now}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM notification_deliveries
        WHERE status = 'pending' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id::text AS id`;
    if (!claimed.length) return result;

    const rows = await this.prisma.notificationDelivery.findMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      include: {
        notification: {
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            data: true,
            createdAt: true,
            user: { select: { isActive: true, phone: true, email: true, pushDevices: { select: { token: true } } } },
          },
        },
      },
    });
    const oldest = new Date(now.getTime() - DELIVERY_MAX_AGE_HOURS * 3_600_000);
    for (const row of rows) {
      const n = row.notification;
      const skip = (reason: string) =>
        this.prisma.notificationDelivery.update({ where: { id: row.id }, data: { status: 'skipped', lastError: reason, claimedAt: null } });
      const channel = row.channel as DeliveryChannel;
      const sender = this[channel];
      if (n.createdAt < oldest) {
        await skip('too old');
        result.skipped++;
        continue;
      }
      if (!n.user.isActive || !sender?.enabled) {
        await skip(!n.user.isActive ? 'user inactive' : 'channel not connected');
        result.skipped++;
        continue;
      }
      const message: DeliveryMessage = {
        notificationId: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: (n.data as Record<string, unknown> | null) ?? null,
      };
      let outcome: SendOutcome;
      if (channel === 'push') {
        const tokens = n.user.pushDevices.map((d) => d.token);
        if (!tokens.length) {
          await skip('no device');
          result.skipped++;
          continue;
        }
        outcome = await this.push.send(tokens, message);
        if (outcome.deadTokens?.length) await this.prisma.pushDevice.deleteMany({ where: { token: { in: outcome.deadTokens } } });
      } else if (channel === 'sms') {
        const to = toE164(n.user.phone);
        if (!to) {
          await skip('no usable phone number');
          result.skipped++;
          continue;
        }
        outcome = await this.sms.send(to, message);
      } else {
        outcome = await this.email.send(n.user.email, message);
      }

      if (outcome.ok) {
        await this.prisma.$transaction([
          this.prisma.notificationDelivery.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: now, providerMessageId: outcome.providerMessageId, lastError: null, claimedAt: null },
          }),
          this.prisma.notification.update({
            where: { id: n.id },
            data: channel === 'push' ? { sentViaPush: true } : channel === 'sms' ? { sentViaSms: true } : { sentViaEmail: true },
          }),
        ]);
        result.sent++;
      } else if (outcome.retry && row.attempts < MAX_ATTEMPTS) {
        const wait = RETRY_DELAYS_MINUTES[row.attempts - 1] ?? RETRY_DELAYS_MINUTES.at(-1)!;
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'pending', nextAttemptAt: new Date(now.getTime() + wait * 60_000), lastError: outcome.error, claimedAt: null },
        });
        result.retried++;
      } else {
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'failed', lastError: outcome.error, claimedAt: null },
        });
        result.failed++;
      }
    }
    if (result.failed) this.logger.warn(`notification deliveries: ${result.failed} failed for good`);
    return result;
  }
}
