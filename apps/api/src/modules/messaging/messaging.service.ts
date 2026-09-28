import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { PhiCryptoService } from '../../common/crypto/phi-crypto.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { DocumentsService } from '../documents/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { messageContentContext as contentContext } from './message-content.js';
import type {
  ContactsQueryDto,
  CreateConversationDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './dto/messaging.dto.js';

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;
const CONVERSATION_INCLUDE = {
  participants: { include: { user: PERSON }, orderBy: { joinedAt: 'asc' } },
  patient: PERSON,
} satisfies Prisma.ConversationInclude;
type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;
const MESSAGE_INCLUDE = {
  sender: PERSON,
  document: { select: { id: true, title: true, fileName: true } },
} satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

type Person = { id: string; firstName: string; lastName: string };

export interface MessageView {
  id: string;
  conversationId: string;
  sender: Person;
  content: string;
  isUrgent: boolean;
  document: { id: string; title: string; fileName: string } | null;
  createdAt: Date;
}

export interface ConversationView {
  id: string;
  type: string;
  subject: string | null;
  patient: Person | null;
  participants: (Person & { left: boolean })[];
  lastMessage: MessageView | null;
  lastMessageAt: Date | null;
  unread: number;
  /** The caller left this group: they can read what was said before, not send. */
  left: boolean;
}

/**
 * Secure messaging between agency staff (DESIGN.md §6.13, DECISIONS D-057). Only participants can see a conversation
 * (others get 404). Message text is encrypted at rest; socket pushes carry IDs only, and clients fetch the text.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PhiCryptoService,
    private readonly patients: PatientsService,
    private readonly documents: DocumentsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** People the caller can message: active staff in the agency (not portal users). Names only. */
  async contacts(caller: AuthUser, query: ContactsQueryDto) {
    const words = query.search?.split(/\s+/).filter(Boolean) ?? [];
    const users = await this.prisma.user.findMany({
      where: {
        ...this.messageable(caller.agencyId),
        id: { not: caller.userId },
        AND: words.map((w) => ({
          OR: [
            { firstName: { contains: w, mode: 'insensitive' as const } },
            { lastName: { contains: w, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: { id: true, firstName: true, lastName: true, userRoles: { select: { role: { select: { name: true } } } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 50,
    });
    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      roles: u.userRoles.map((r) => r.role.name),
    }));
  }

  async list(caller: AuthUser, query: ListConversationsQueryDto): Promise<ConversationView[]> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        agencyId: caller.agencyId,
        participants: { some: { userId: caller.userId } },
        ...(query.patientId ? { patientId: query.patientId } : {}),
      },
      include: CONVERSATION_INCLUDE,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: query.limit ?? 50,
    });
    const ids = rows.map((r) => r.id);
    const [unread, last] = await Promise.all([this.unreadByConversation(caller.userId, ids), this.latestVisibleMany(caller.userId, ids)]);
    return rows.map((r) => this.toConversation(caller.userId, r, last.get(r.id) ?? null, unread.get(r.id) ?? 0));
  }

  async get(caller: AuthUser, id: string): Promise<ConversationView> {
    const row = await this.find(caller, id);
    const [unread, last] = await Promise.all([
      this.unreadByConversation(caller.userId, [id]),
      this.latestVisible(caller.userId, row),
    ]);
    return this.toConversation(caller.userId, row, last, unread.get(id) ?? 0);
  }

  /** Total unread messages for the caller — the badge in the navigation. */
  async unreadCount(caller: AuthUser): Promise<{ unread: number }> {
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM messages m
      JOIN conversation_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ${caller.userId}::uuid
      WHERE m.agency_id = ${caller.agencyId}::uuid AND m.sender_id <> ${caller.userId}::uuid
        AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        AND (p.left_at IS NULL OR m.created_at <= p.left_at)`;
    return { unread: Number(rows[0]?.n ?? 0) };
  }

  /**
   * Start a conversation with its first message. With one other person and no subject or patient, the existing
   * direct conversation between the two is reused.
   */
  async create(caller: AuthUser, dto: CreateConversationDto): Promise<ConversationView> {
    const others = [...new Set(dto.participantIds)].filter((id) => id !== caller.userId);
    if (!others.length) throw new BadRequestException('Add at least one other person');
    const found = await this.prisma.user.count({ where: { ...this.messageable(caller.agencyId), id: { in: others } } });
    if (found !== others.length) throw new BadRequestException('Some people can’t be messaged (not active staff in this agency)');
    if (dto.patientId) await this.patients.assertAccessible(caller, dto.patientId);
    if (dto.documentId) await this.assertAttachable(caller, dto.documentId); // before creating anything

    const direct = others.length === 1 && !dto.subject && !dto.patientId;
    let conversationId = direct ? await this.findDirect(caller, others[0]!) : null;
    if (!conversationId) {
      conversationId = (
        await this.prisma.conversation.create({
          data: {
            agencyId: caller.agencyId,
            type: direct ? 'direct' : 'group',
            subject: dto.subject || null,
            patientId: dto.patientId ?? null,
            createdById: caller.userId,
            participants: { create: [caller.userId, ...others].map((userId) => ({ userId })) },
          },
          select: { id: true },
        })
      ).id;
    }
    await this.send(caller, conversationId, dto);
    return this.get(caller, conversationId);
  }

  /** Newest first, `limit` at a time; page back with `before`. */
  async messages(caller: AuthUser, id: string, query: ListMessagesQueryDto): Promise<MessageView[]> {
    const conversation = await this.find(caller, id);
    const me = conversation.participants.find((p) => p.userId === caller.userId)!;
    const before = query.before ? new Date(query.before) : undefined;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        createdAt: { ...(before ? { lt: before } : {}), ...(me.leftAt ? { lte: me.leftAt } : {}) },
      },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
    });
    return rows.map((m) => this.toMessage(m));
  }

  async send(caller: AuthUser, id: string, dto: SendMessageDto): Promise<MessageView> {
    const conversation = await this.find(caller, id);
    const me = conversation.participants.find((p) => p.userId === caller.userId)!;
    if (me.leftAt) throw new ConflictException('You left this conversation');
    if (dto.documentId) await this.assertAttachable(caller, dto.documentId);
    const messageId = randomUUID();
    const now = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          id: messageId,
          agencyId: caller.agencyId,
          conversationId: id,
          senderId: caller.userId,
          contentEncrypted: this.crypto.encryptBytes(Buffer.from(dto.content, 'utf8'), contentContext(messageId)),
          isUrgent: dto.isUrgent ?? false,
          documentId: dto.documentId ?? null,
          createdAt: now,
        },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } }),
      this.prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: id, userId: caller.userId } },
        data: { lastReadAt: now },
      }),
    ]);

    const recipients = conversation.participants.filter((p) => !p.leftAt && p.userId !== caller.userId);
    const push = { conversationId: id, messageId, senderId: caller.userId, isUrgent: message.isUrgent, createdAt: now };
    for (const p of recipients) this.realtime.toUser(p.userId, 'message:new', push);
    if (message.isUrgent) {
      await this.notifications.notify({
        agencyId: caller.agencyId,
        userIds: recipients.filter((p) => !p.isMuted).map((p) => p.userId),
        type: 'message_received',
        title: 'Urgent message',
        body: `From ${message.sender.firstName} ${message.sender.lastName}. Open Messages to read it.`,
        data: { conversationId: id },
        actorUserId: caller.userId,
      });
    }
    return this.toMessage(message);
  }

  async markRead(caller: AuthUser, id: string): Promise<void> {
    await this.find(caller, id);
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId: caller.userId } },
      data: { lastReadAt: new Date() },
    });
  }

  /** Groups only. Someone who left can be added back. */
  async addParticipants(caller: AuthUser, id: string, userIds: string[]): Promise<ConversationView> {
    const conversation = await this.find(caller, id);
    if (conversation.type !== 'group') throw new ConflictException('Start a new conversation to add people to a direct message');
    if (conversation.participants.find((p) => p.userId === caller.userId)!.leftAt) {
      throw new ConflictException('You left this conversation');
    }
    const ids = [...new Set(userIds)];
    const found = await this.prisma.user.count({ where: { ...this.messageable(caller.agencyId), id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('Some people can’t be messaged (not active staff in this agency)');
    if (conversation.participants.length + ids.length > 100) throw new BadRequestException('Too many people in one conversation');
    await this.prisma.$transaction(
      ids.map((userId) =>
        this.prisma.conversationParticipant.upsert({
          where: { conversationId_userId: { conversationId: id, userId } },
          create: { conversationId: id, userId },
          update: { leftAt: null },
        }),
      ),
    );
    return this.get(caller, id);
  }

  async leave(caller: AuthUser, id: string): Promise<void> {
    const conversation = await this.find(caller, id);
    if (conversation.type !== 'group') throw new ConflictException('You can’t leave a direct conversation');
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId: id, userId: caller.userId, leftAt: null },
      data: { leftAt: new Date() },
    });
  }

  // ---- Patient portal (D-058). The portal controller has already checked the portal user belongs to the patient. ----

  /** The portal user's conversation with the care team about one patient, with its messages (newest first). */
  async portalThread(caller: AuthUser, patientId: string, query: ListMessagesQueryDto) {
    const conversation = await this.findPortal(caller, patientId);
    if (!conversation) return { conversationId: null, unread: 0, messages: [] as MessageView[] };
    const [unread, messages] = await Promise.all([
      this.unreadByConversation(caller.userId, [conversation.id]),
      this.messages(caller, conversation.id, query),
    ]);
    return { conversationId: conversation.id, unread: unread.get(conversation.id) ?? 0, messages };
  }

  /**
   * A message from the portal to the care team. The first one opens the conversation; every message (re)adds the
   * agency's current portal responders (`messages:portal`) and alerts them in-app (no content in the alert).
   */
  async portalSend(caller: AuthUser, patientId: string, content: string): Promise<MessageView> {
    const [responders, existing] = await Promise.all([
      this.portalResponders(caller.agencyId),
      this.findPortal(caller, patientId),
    ]);
    const conversationId =
      existing?.id ??
      (
        await this.prisma.conversation.create({
          data: {
            agencyId: caller.agencyId,
            type: 'portal',
            patientId,
            createdById: caller.userId,
            participants: { create: { userId: caller.userId } },
          },
          select: { id: true },
        })
      ).id;
    // Two set-based statements instead of an upsert per responder (each is a round trip to the database).
    await Promise.all([
      this.prisma.conversationParticipant.createMany({
        data: responders.map((userId) => ({ conversationId, userId })),
        skipDuplicates: true,
      }),
      this.prisma.conversationParticipant.updateMany({
        where: { conversationId, userId: { in: responders }, leftAt: { not: null } },
        data: { leftAt: null },
      }),
    ]);
    const message = await this.send(caller, conversationId, { content });
    await this.notifications.notify({
      agencyId: caller.agencyId,
      userIds: responders,
      type: 'message_received',
      title: 'New patient portal message',
      body: 'A patient or family member wrote to the care team. Open Messages to read it.',
      data: { conversationId },
      actorUserId: caller.userId,
    });
    return message;
  }

  async portalMarkRead(caller: AuthUser, patientId: string): Promise<void> {
    const conversation = await this.findPortal(caller, patientId);
    if (conversation) await this.markRead(caller, conversation.id);
  }

  private findPortal(caller: AuthUser, patientId: string) {
    return this.prisma.conversation.findFirst({
      where: { agencyId: caller.agencyId, type: 'portal', patientId, createdById: caller.userId },
      select: { id: true },
    });
  }

  /** Active staff whose role (built-in or this agency's) grants `messages:portal`. */
  private async portalResponders(agencyId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        ...this.messageable(agencyId),
        userRoles: {
          some: {
            role: {
              OR: [{ agencyId: null }, { agencyId }],
              rolePermissions: { some: { permission: { resource: 'messages', action: 'portal' } } },
            },
          },
        },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** 404 unless the sender can see the document. */
  private async assertAttachable(caller: AuthUser, documentId: string): Promise<void> {
    const doc = await this.documents.get(caller, documentId);
    if (doc.deleted) throw new BadRequestException('That document was deleted');
  }

  private messageable(agencyId: string): Prisma.UserWhereInput {
    return { agencyId, isActive: true, userRoles: { some: { role: { name: { not: 'portal_user' } } } } };
  }

  private async findDirect(caller: AuthUser, otherId: string): Promise<string | null> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        agencyId: caller.agencyId,
        type: 'direct',
        AND: [{ participants: { some: { userId: caller.userId } } }, { participants: { some: { userId: otherId } } }],
      },
      select: { id: true },
    });
    return existing?.id ?? null;
  }

  private async find(caller: AuthUser, id: string): Promise<ConversationRow> {
    const row = await this.prisma.conversation.findFirst({
      where: { id, agencyId: caller.agencyId, participants: { some: { userId: caller.userId } } },
      include: CONVERSATION_INCLUDE,
    });
    if (!row) throw new NotFoundException('Conversation not found');
    return row;
  }

  /**
   * The newest message the caller can see in each conversation — two queries for the whole list instead of one per
   * conversation (P4-09 load test, D-068). "Can see": up to when they left, if they left.
   */
  private async latestVisibleMany(userId: string, ids: string[]): Promise<Map<string, MessageRow>> {
    if (!ids.length) return new Map();
    const latest = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (m.conversation_id) m.id::text AS id FROM messages m
      JOIN conversation_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ${userId}::uuid
      WHERE m.conversation_id = ANY(${ids}::uuid[]) AND (p.left_at IS NULL OR m.created_at <= p.left_at)
      ORDER BY m.conversation_id, m.created_at DESC, m.id DESC`;
    if (!latest.length) return new Map();
    const messages = await this.prisma.message.findMany({ where: { id: { in: latest.map((l) => l.id) } }, include: MESSAGE_INCLUDE });
    return new Map(messages.map((m) => [m.conversationId, m]));
  }

  private async latestVisible(userId: string, row: ConversationRow): Promise<MessageRow | null> {
    const leftAt = row.participants.find((p) => p.userId === userId)?.leftAt;
    return this.prisma.message.findFirst({
      where: { conversationId: row.id, ...(leftAt ? { createdAt: { lte: leftAt } } : {}) },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async unreadByConversation(userId: string, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<{ conversation_id: string; n: bigint }[]>`
      SELECT m.conversation_id::text AS conversation_id, count(*) AS n FROM messages m
      JOIN conversation_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ${userId}::uuid
      WHERE m.conversation_id = ANY(${ids}::uuid[]) AND m.sender_id <> ${userId}::uuid
        AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        AND (p.left_at IS NULL OR m.created_at <= p.left_at)
      GROUP BY m.conversation_id`;
    return new Map(rows.map((r) => [r.conversation_id, Number(r.n)]));
  }

  private toMessage(m: MessageRow): MessageView {
    return {
      id: m.id,
      conversationId: m.conversationId,
      sender: m.sender,
      content: this.crypto.decryptBytes(m.contentEncrypted, contentContext(m.id)).toString('utf8'),
      isUrgent: m.isUrgent,
      document: m.document,
      createdAt: m.createdAt,
    };
  }

  private toConversation(userId: string, r: ConversationRow, last: MessageRow | null, unread: number): ConversationView {
    return {
      id: r.id,
      type: r.type,
      subject: r.subject,
      patient: r.patient,
      participants: r.participants.map((p) => ({ ...p.user, left: Boolean(p.leftAt) })),
      lastMessage: last ? this.toMessage(last) : null,
      lastMessageAt: r.lastMessageAt,
      unread,
      left: Boolean(r.participants.find((p) => p.userId === userId)?.leftAt),
    };
  }
}
