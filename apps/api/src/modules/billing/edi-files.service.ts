import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { EdiService } from './edi.service.js';
import { describeStatus, parse277ca } from './edi/edi-277ca.js';
import { ACK_999_CODES, describe999Error, parse999 } from './edi/edi-999.js';
import { readX12, X12Error, zeroPad } from './edi/x12.js';

export interface EdiFileView {
  id: string;
  fileType: string;
  direction: string;
  fileName: string | null;
  controlNumber: string | null;
  recordCount: number | null;
  status: string;
  payer: { id: string; name: string } | null;
  claims: { id: string; claimNumber: string; status: string }[];
  errorDetails: unknown;
  createdAt: Date;
  processedAt: Date | null;
}

export interface AckResult {
  file: EdiFileView;
  kind: '999' | '277CA';
  accepted: string[];
  rejected: { claimNumber: string; reason: string }[];
  /** Claim numbers in the acknowledgment that aren't this agency's (or no longer waiting). */
  unmatched: string[];
}

const FILE_INCLUDE = {
  claims: { select: { id: true, claimNumber: true, status: true, payer: { select: { id: true, name: true } } }, orderBy: { claimNumber: 'asc' } },
} satisfies Prisma.EdiFileInclude;
type FileRow = Prisma.EdiFileGetPayload<{ include: typeof FILE_INCLUDE }>;

/** Statuses an acknowledgment may still change. */
const AWAITING_ACK = ['ready', 'submitted', 'acknowledged'];

/**
 * Claim files (DECISIONS D-076) — works before any clearinghouse connection: billing makes one 837 file per payer
 * from ready claims (real, increasing interchange control numbers), downloads it and uploads it to the clearinghouse
 * portal, then marks it sent. The 999 (file accepted?) and 277CA (each claim accepted?) that come back are uploaded
 * here and applied: rejected claims get the reason and can be fixed, re-checked and sent again.
 */
@Injectable()
export class EdiFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly edi: EdiService,
  ) {}

  async create837(caller: AuthUser, claimIds: string[], test: boolean): Promise<EdiFileView> {
    // Never the same claim in two unsent files (it would be billed twice); download the existing file instead.
    const pending = await this.prisma.claim.findMany({
      where: { id: { in: claimIds }, agencyId: caller.agencyId, ediFile: { status: 'generated' } },
      select: { claimNumber: true, ediFile: { select: { fileName: true } } },
    });
    if (pending.length) {
      throw new ConflictException(
        `Already in a file that hasn't been sent: ${pending.map((c) => `${c.claimNumber} (${c.ediFile!.fileName})`).join(', ')}`,
      );
    }
    // Number, build and save in one transaction: the counter row stays locked until the file exists, and a refused
    // file (missing data, mixed payers) gives its number back — numbers only go to files that exist.
    const fileId = await this.prisma.$transaction(
      async (tx) => {
        const [counter] = await tx.$queryRaw<{ n: number }[]>`
          UPDATE agencies SET edi_control_number = edi_control_number + 1 WHERE id = ${caller.agencyId}::uuid
          RETURNING edi_control_number AS n`;
        const controlNumber = ((counter!.n - 1) % 999_999_999) + 1;
        const built = await this.edi.build837File(caller, claimIds, controlNumber, test ? 'T' : 'P');
        const icn = zeroPad(controlNumber, 9);
        const created = await tx.ediFile.create({
          data: {
            agencyId: caller.agencyId,
            fileType: built.format,
            direction: 'outbound',
            fileName: `${built.format}-${icn}${test ? '-TEST' : ''}.edi`,
            content: built.content,
            contentHash: sha256(built.content),
            interchangeControlNumber: icn,
            recordCount: built.claimIds.length,
            status: 'generated',
            uploadedById: caller.userId,
          },
        });
        // Guarded: a claim that stopped being ready meanwhile fails the whole file.
        const linked = await tx.claim.updateMany({
          where: { id: { in: built.claimIds }, agencyId: caller.agencyId, status: 'ready' },
          data: { ediFileId: created.id },
        });
        if (linked.count !== built.claimIds.length) throw new ConflictException('A claim changed meanwhile — reload and try again');
        return created.id;
      },
      { timeout: 60_000 },
    );
    return this.get(caller, fileId);
  }

  async list(caller: AuthUser, query: PaginationQueryDto): Promise<Paginated<EdiFileView>> {
    const where: Prisma.EdiFileWhereInput = { agencyId: caller.agencyId, fileType: { in: ['837P', '837I', '999', '277'] } };
    const [rows, total] = await Promise.all([
      this.prisma.ediFile.findMany({ where, include: FILE_INCLUDE, orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.limit }),
      this.prisma.ediFile.count({ where }),
    ]);
    return Paginated.of(rows.map(toView), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<EdiFileView> {
    return toView(await this.find(caller, id));
  }

  async download(caller: AuthUser, id: string): Promise<{ fileName: string; content: string }> {
    const file = await this.find(caller, id);
    if (!file.content) throw new NotFoundException('This file has no stored content');
    return { fileName: file.fileName ?? `${file.fileType}-${file.id}.edi`, content: file.content };
  }

  /** Staff uploaded the file to the clearinghouse: its ready claims become submitted (the aging clock starts). */
  async markSent(caller: AuthUser, id: string): Promise<EdiFileView> {
    const file = await this.find(caller, id);
    if (file.direction !== 'outbound' || file.status !== 'generated') throw new ConflictException('Only a new outbound file can be marked as sent');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.ediFile.update({ where: { id }, data: { status: 'submitted', processedAt: now } }),
      this.prisma.claim.updateMany({
        where: { ediFileId: id, status: 'ready' },
        data: { status: 'submitted', submittedAt: now, submittedById: caller.userId },
      }),
    ]);
    return this.get(caller, id);
  }

  /** A 999 or 277CA from the clearinghouse: stored, then applied to our files and claims. */
  async uploadAck(caller: AuthUser, fileName: string, content: string): Promise<AckResult> {
    let kind: '999' | '277CA';
    try {
      const st = readX12(content).segments.find((s) => s[0] === 'ST');
      if (st?.[1] === '999') kind = '999';
      else if (st?.[1] === '277') kind = '277CA';
      else throw new BadRequestException('This is neither a 999 nor a 277CA acknowledgment (for an 835, use Payments)');
    } catch (error) {
      if (error instanceof X12Error) throw new BadRequestException(error.message);
      throw error;
    }
    const hash = sha256(content);
    if (await this.prisma.ediFile.findUnique({ where: { agencyId_contentHash: { agencyId: caller.agencyId, contentHash: hash } } })) {
      throw new ConflictException('This file was already loaded');
    }
    const result = kind === '999' ? await this.apply999(caller, content) : await this.apply277(caller, content);
    const file = await this.prisma.ediFile.create({
      data: {
        agencyId: caller.agencyId,
        fileType: kind === '999' ? '999' : '277',
        direction: 'inbound',
        fileName: fileName.slice(0, 255),
        content,
        contentHash: hash,
        recordCount: result.accepted.length + result.rejected.length,
        status: 'parsed',
        processedAt: new Date(),
        uploadedById: caller.userId,
        errorDetails: result.rejected.length || result.unmatched.length ? { rejected: result.rejected, unmatched: result.unmatched } : Prisma.JsonNull,
      },
    });
    return { ...result, kind, file: await this.get(caller, file.id) };
  }

  /** 999: matched to our outbound file by its group control number; a rejected transaction rejects its claims. */
  private async apply999(caller: AuthUser, content: string) {
    let ack;
    try {
      ack = parse999(content);
    } catch (error) {
      if (error instanceof X12Error) throw new BadRequestException(error.message);
      throw error;
    }
    const number = Number(ack.groupControlNumber);
    const file = Number.isInteger(number) && number > 0
      ? await this.prisma.ediFile.findFirst({
          where: { agencyId: caller.agencyId, direction: 'outbound', interchangeControlNumber: zeroPad(number, 9) },
          include: { claims: { select: { id: true, claimNumber: true, status: true } } },
        })
      : null;
    if (!file) return { accepted: [], rejected: [], unmatched: [`file ${ack.groupControlNumber}`] };
    // We send one transaction set per file, so the group verdict is the file's.
    const errors = ack.transactions.flatMap((t) => t.errors.map(describe999Error));
    const waiting = file.claims.filter((c) => AWAITING_ACK.includes(c.status));
    if (ack.groupAccepted) {
      await this.prisma.ediFile.update({ where: { id: file.id }, data: { status: 'accepted' } });
      return { accepted: waiting.map((c) => c.claimNumber), rejected: [], unmatched: [] };
    }
    const reason = `File rejected by the clearinghouse (999: ${ACK_999_CODES[ack.groupCode] ?? ack.groupCode})${errors.length ? ` — ${errors.join('; ')}` : ''}`;
    await this.prisma.$transaction([
      this.prisma.ediFile.update({ where: { id: file.id }, data: { status: 'rejected', errorDetails: { reason } } }),
      this.prisma.claim.updateMany({
        where: { id: { in: waiting.map((c) => c.id) }, status: { in: AWAITING_ACK } },
        data: { status: 'rejected', rejectionReason: reason, rejectedAt: new Date() },
      }),
    ]);
    return { accepted: [], rejected: waiting.map((c) => ({ claimNumber: c.claimNumber, reason })), unmatched: [] };
  }

  /** 277CA: each claim by its claim number — accepted → acknowledged (+ payer claim number), rejected → rejected. */
  private async apply277(caller: AuthUser, content: string) {
    let ack;
    try {
      ack = parse277ca(content);
    } catch (error) {
      if (error instanceof X12Error) throw new BadRequestException(error.message);
      throw error;
    }
    const claims = await this.prisma.claim.findMany({
      where: { agencyId: caller.agencyId, claimNumber: { in: ack.claims.map((c) => c.claimNumber) }, status: { in: AWAITING_ACK } },
      select: { id: true, claimNumber: true },
    });
    const byNumber = new Map(claims.map((c) => [c.claimNumber, c.id]));
    const accepted: string[] = [];
    const rejected: { claimNumber: string; reason: string }[] = [];
    const unmatched: string[] = [];
    const now = new Date();
    for (const c of ack.claims) {
      const id = byNumber.get(c.claimNumber);
      if (!id) {
        unmatched.push(c.claimNumber);
        continue;
      }
      if (c.accepted) {
        await this.prisma.claim.update({
          where: { id },
          data: { status: 'acknowledged', rejectionReason: null, ...(c.payerClaimNumber ? { payerClaimNumber: c.payerClaimNumber } : {}) },
        });
        accepted.push(c.claimNumber);
      } else {
        const reason = `Rejected by the payer (277CA): ${c.statuses.map(describeStatus).join('; ')}`;
        await this.prisma.claim.update({ where: { id }, data: { status: 'rejected', rejectionReason: reason, rejectedAt: now } });
        rejected.push({ claimNumber: c.claimNumber, reason });
      }
    }
    return { accepted, rejected, unmatched };
  }

  private async find(caller: AuthUser, id: string): Promise<FileRow> {
    const file = await this.prisma.ediFile.findFirst({ where: { id, agencyId: caller.agencyId }, include: FILE_INCLUDE });
    if (!file) throw new NotFoundException('File not found');
    return file;
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function toView(f: FileRow): EdiFileView {
  return {
    id: f.id,
    fileType: f.fileType,
    direction: f.direction,
    fileName: f.fileName,
    controlNumber: f.interchangeControlNumber,
    recordCount: f.recordCount,
    status: f.status,
    payer: f.claims[0]?.payer ?? null,
    claims: f.claims.map((c) => ({ id: c.id, claimNumber: c.claimNumber, status: c.status })),
    errorDetails: f.errorDetails,
    createdAt: f.createdAt,
    processedAt: f.processedAt,
  };
}
