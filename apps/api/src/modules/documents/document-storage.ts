import { Injectable } from '@nestjs/common';
import { PhiCryptoService } from '../../common/crypto/phi-crypto.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Where document files live (DECISIONS D-056). Callers only see this interface, so moving to object storage
 * (S3 with a BAA, server-side encryption) at go-live is a new implementation, not a rewrite.
 */
export abstract class DocumentStorage {
  /** Stores the file for a document (inside the caller's transaction when given). */
  abstract save(
    documentId: string,
    content: Buffer,
    tx?: Prisma.TransactionClient,
  ): Promise<string>;
  abstract load(documentId: string): Promise<Buffer>;
}

/** The storage key recorded in `documents.s3_key` for database-stored files. */
export const databaseKey = (documentId: string) => `db:${documentId}`;

/**
 * Development/interim driver: the file in `document_blobs`, encrypted with the PHI key (AES-256-GCM) and bound to the
 * document id, so a blob can't be moved to another document and still decrypt.
 */
@Injectable()
export class DatabaseDocumentStorage extends DocumentStorage {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PhiCryptoService,
  ) {
    super();
  }

  async save(documentId: string, content: Buffer, tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx ?? this.prisma;
    await db.documentBlob.create({
      data: { documentId, content: this.crypto.encryptBytes(content, context(documentId)) },
    });
    return databaseKey(documentId);
  }

  async load(documentId: string): Promise<Buffer> {
    const blob = await this.prisma.documentBlob.findUniqueOrThrow({ where: { documentId } });
    return this.crypto.decryptBytes(blob.content, context(documentId));
  }
}

const context = (documentId: string) => `documents.content:${documentId}`;
