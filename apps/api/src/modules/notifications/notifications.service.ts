import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MANDATORY_NOTIFICATION_TYPES, NOTIFICATION_TYPES, type DeliveryChannel, type NotificationType } from '@alora/shared';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { effectiveChannel, plannedChannels } from './delivery/delivery-plan.js';
import { NotificationDeliveryService } from './delivery/delivery.service.js';

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
 * Notifications (DESIGN.md §13, DECISIONS D-032, D-071). Other modules call `notify()`: the in-app inbox record, a
 * live socket event, and — for channels the agency has connected — push / SMS / email rows in the delivery outbox,
 * which the delivery job sends.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  /** Never throws: a failed notification must not fail the action that triggered it. */
  async notify(notification: NewNotification): Promise<void> {
    const recipients = [...new Set(notification.userIds.filter((id): id is string => Boolean(id)))].filter(
      (id) => id !== notification.actorUserId,
    );
    if (!recipients.length) return;
    try {
      const mandatory = MANDATORY_NOTIFICATION_TYPES.includes(notification.type);
      const available = this.delivery.available();
      const outside = available.push || available.sms || available.email;
      const [prefs, users] = await Promise.all([
        this.prisma.notificationPreference.findMany({
          where: { userId: { in: recipients }, notificationType: notification.type },
        }),
        outside
          ? this.prisma.user.findMany({
              where: { id: { in: recipients } },
              select: {
                id: true,
                isActive: true,
                phone: true,
                userRoles: { select: { role: { select: { name: true } } } },
                _count: { select: { pushDevices: true } },
              },
            })
          : [],
      ]);
      const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
      const userById = new Map(users.map((u) => [u.id, u]));
      // In-app unless switched off (D-066; mandatory types always); outside channels per D-071.
      const plan = recipients
        .map((userId) => {
          const pref = prefByUser.get(userId) ?? null;
          const u = userById.get(userId);
          const channels: DeliveryChannel[] = u
            ? plannedChannels({
                type: notification.type,
                preference: pref,
                available,
                recipient: {
                  isActive: u.isActive,
                  isPortalUser: u.userRoles.some((r) => r.role.name === 'portal_user'),
                  hasPhone: Boolean(u.phone),
                  hasEmail: true,
                  pushDevices: u._count.pushDevices,
                },
              })
            : [];
          const inApp = mandatory || (pref?.channelInApp ?? true);
          return { userId, inApp, channels };
        })
        .filter((p) => p.inApp || p.channels.length);
      if (!plan.length) return;

      const created = await this.prisma.notification.createManyAndReturn({
        data: plan.map((p) => ({
          agencyId: notification.agencyId,
          userId: p.userId,
          type: notification.type,
          title: notification.title,
          body: notification.body ?? null,
          data: notification.data ?? Prisma.JsonNull,
          channels: [...(p.inApp ? ['in_app'] : []), ...p.channels],
        })),
      });
      const deliveries = created.flatMap((row) =>
        row.channels.filter((c) => c !== 'in_app').map((channel) => ({ notificationId: row.id, channel })),
      );
      if (deliveries.length) await this.prisma.notificationDelivery.createMany({ data: deliveries });
      // Live delivery to open apps (D-041); the inbox API remains the source of truth.
      for (const row of created) {
        if (row.channels.includes('in_app')) this.realtime.toUser(row.userId, 'notification:new', toView(row));
      }
    } catch (error) {
      this.logger.error(`Failed to create ${notification.type} notification`, (error as Error).stack);
    }
  }

  /** Channels outside the app that the agency has connected (the settings page says which aren't yet). */
  channels(): Record<DeliveryChannel, boolean> {
    return this.delivery.available();
  }

  /** A phone signed in to the mobile app that can receive push notifications. The phone moves to whoever registers it. */
  async registerDevice(caller: AuthUser, dto: { token: string; platform: string }): Promise<{ registered: true }> {
    await this.prisma.pushDevice.upsert({
      where: { token: dto.token },
      create: { userId: caller.userId, token: dto.token, platform: dto.platform },
      update: { userId: caller.userId, platform: dto.platform, lastSeenAt: new Date() },
    });
    return { registered: true };
  }

  /** Sign-out on the phone: stop pushing to it (only the caller's own devices). */
  async unregisterDevice(caller: AuthUser, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { token, userId: caller.userId } });
  }

  /** Every notification type with the caller's channel choices (in-app on by default; others per type). */
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
        // Outside channels default per type (DESIGN.md §13.2, D-071).
        push: effectiveChannel(type, 'push', r ?? null),
        sms: effectiveChannel(type, 'sms', r ?? null),
        email: effectiveChannel(type, 'email', r ?? null),
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
    // A new row starts from the type's defaults (not the columns' all-on defaults), then takes what was sent.
    const t = type as NotificationType;
    await this.prisma.notificationPreference.upsert({
      where: { userId_notificationType: { userId: caller.userId, notificationType: type } },
      create: {
        userId: caller.userId,
        notificationType: type,
        channelPush: effectiveChannel(t, 'push', null),
        channelSms: effectiveChannel(t, 'sms', null),
        channelEmail: effectiveChannel(t, 'email', null),
        ...data,
      },
      update: data,
    });
    return this.preferences(caller);
  }

  async list(caller: AuthUser, query: PaginationQueryDto & { unreadOnly?: boolean }): Promise<Paginated<NotificationView>> {
    const where: Prisma.NotificationWhereInput = {
      userId: caller.userId,
      agencyId: caller.agencyId,
      channels: { has: 'in_app' }, // not the ones someone only wanted by text/email
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
        where: { userId: caller.userId, agencyId: caller.agencyId, channels: { has: 'in_app' }, isRead: false },
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
