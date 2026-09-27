import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** The single Prisma client for the app. Prisma 7 talks to Postgres through the `pg` driver adapter. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const connectionString = config.get('DATABASE_URL', { infer: true });
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — the database module needs it');
    }
    super({
      adapter: new PrismaPg({
        connectionString,
        // Serverless Postgres (e.g. Neon) closes idle connections when it scales to zero; recycle ours first
        // so a request never picks up a connection the server already dropped.
        idleTimeoutMillis: 60_000,
        // Fail fast (and visibly) instead of hanging when the database is unreachable.
        connectionTimeoutMillis: 10_000,
      }),
      // Prisma's defaults (2 s to get a connection, 5 s total) are tight for a remote database whose
      // connections can take seconds to open after it wakes; they caused intermittent test failures.
      transactionOptions: { maxWait: 10_000, timeout: 15_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
