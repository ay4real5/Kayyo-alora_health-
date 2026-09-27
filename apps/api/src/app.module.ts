import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';

@Module({
  imports: [
    AppConfigModule,
    // General per-IP rate limit; credential endpoints set a stricter one with @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    CryptoModule,
    AuditModule,
    RbacModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limiting runs before authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
