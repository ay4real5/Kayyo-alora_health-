import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MANDATORY_NOTIFICATION_TYPES, NOTIFICATION_TYPES, type NotificationType } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { Prisma } from '../../generated/prisma/client.js';

export interface NewNotification {
  agencyId: string;
  /** Recipients (users). Duplicates and the `actorUserId` are dropped. */
  userIds: (string | null | undefined)[];
  type: NotificationType;
  /** Short and generic — NEVER PHI (no patient names, addresses, diagnoses). DESIGN.md §13.3. */
  title: string;
  /** Also PHI-free. Point people to the app for details. */
  body?: string;
  /** IDs the client needs to deep-link (e.g. { visitId }). IDs only. */
  data?: Record<string, string | number | boolean | null>;
  /** Who caused it — never notified about their own action. */
  actorUserId?: string;
}

export interface PreferenceView {
  type: NotificationType;
  /** Can't be switched off in the app. */
  mandatory: boolean;
  inApp: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
}

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * In-app notifications (DESIGN.md §13, DECISIONS D-032). Other modules call `notify()`. Delivery beyond the
 * in-app inbox (push, SMS, email, live socket events) is added by later tasks on top of the same records.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Never throws: a failed notification must not fail the action that triggered it. */
  async notify(notification: NewNotification): Promise<void> {
    let recipients = [...new Set(notification.userIds.filter((id): id is string => Boolean(id)))].filter(
      (id) => id !== notification.actorUserId,
    );
    if (!recipients.length) return;
    try {
      // People who switched this alert off in the app don't get it (D-066); mandatory types always go out.
      if (!MANDATORY_NOTIFICATION_TYPES.includes(notification.type)) {
        const off = await this.prisma.notificationPreference.findMany({
          where: { userId: { in: recipients }, notificationType: notification.type, channelInApp: false },
          select: { userId: true },
        });
        const muted = new Set(off.map((p) => p.userId));
        recipients = recipients.filter((id) => !muted.has(id));
        if (!recipients.length) return;
      }
      const created = await this.prisma.notification.createManyAndReturn({
        data: recipients.map((userId) => ({
          agencyId: notification.agencyId,
          userId,
          type: notification.type,
          title: notification.title,
          body: notification.body ?? null,
          data: notification.data ?? Prisma.JsonNull,
          channels: ['in_app'],
        })),
      });
      // Live delivery to open apps (D-041); the inbox API remains the source of truth.
      for (const row of created) this.realtime.toUser(row.userId, 'notification:new', toView(row));
    } catch (error) {
      this.logger.error(`Failed to create ${notification.type} notification`, (error as Error).stack);
    }
  }

  /** Every notification type with the caller's channel choices (defaults: all on). */
  async preferences(caller: AuthUser): Promise<PreferenceView[]> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId: caller.userId } });
    const byType = new Map(rows.map((r) => [r.notificationType, r]));
    return NOTIFICATION_TYPES.map((type) => {
      const r = byType.get(type);
      const mandatory = MANDATORY_NOTIFICATION_TYPES.includes(type);
      return {
        type,
        mandatory,
        inApp: mandatory || (r?.channelInApp ?? true),
        push: r?.channelPush ?? true,
        sms: r?.channelSms ?? true,
        email: r?.channelEmail ?? true,
      };
    });
  }

  async setPreference(
    caller: AuthUser,
    type: string,
    dto: { inApp?: boolean; push?: boolean; sms?: boolean; email?: boolean },
  ): Promise<PreferenceView[]> {
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Unknown notification type');
    if (MANDATORY_NOTIFICATION_TYPES.includes(type as NotificationType) && dto.inApp === false) {
      throw new BadRequestException('This alert can’t be turned off');
    }
    const data = {
      ...(dto.inApp !== undefined ? { channelInApp: dto.inApp } : {}),
      ...(dto.push !== undefined ? { channelPush: dto.push } : {}),
      ...(dto.sms !== undefined ? { channelSms: dto.sms } : {}),
      ...(dto.email !== undefined ? { channelEmail: dto.email } : {}),
    };
    await this.prisma.notificationPreference.upsert({
      where: { userId_notificationType: { userId: caller.userId, notificationType: type } },
      create: { userId: caller.userId, notificationType: type, ...data },
      update: data,
    });
    return this.preferences(caller);
  }

  async list(caller: AuthUser, query: PaginationQueryDto & { unreadOnly?: boolean }): Promise<Paginated<NotificationView>> {
    const where: Prisma.NotificationWhereInput = {
      userId: caller.userId,
      agencyId: caller.agencyId,
      ...(query.unreadOnly ? { isRead: false } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.limit }),
      this.prisma.notification.count({ where }),
    ]);
    return Paginated.of(rows.map(toView), total, query);
  }

  async unreadCount(caller: AuthUser): Promise<{ unread: number }> {
    return {
      unread: await this.prisma.notification.count({
        where: { userId: caller.userId, agencyId: caller.agencyId, isRead: false },
      }),
    };
  }

  async markRead(caller: AuthUser, id: string): Promise<NotificationView> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId: caller.userId, agencyId: caller.agencyId },
    });
    if (!existing) throw new NotFoundException('Notification not found');
    if (existing.isRead) return toView(existing);
    return toView(await this.prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } }));
  }

  async markAllRead(caller: AuthUser): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: caller.userId, agencyId: caller.agencyId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }
}

function toView(n: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    isRead: n.isRead,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
