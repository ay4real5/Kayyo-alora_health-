import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import type { EnvironmentVariables } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { ScheduleModule } from '@nestjs/schedule';
import { PatientsModule } from './modules/patients/patients.module.js';
import { PhysiciansModule } from './modules/physicians/physicians.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { StaffModule } from './modules/staff/staff.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { EvvModule } from './modules/evv/evv.module.js';
import { IvrModule } from './modules/ivr/ivr.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { AgencyModule } from './modules/agency/agency.module.js';
import { ClinicalModule } from './modules/clinical/clinical.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { MessagingModule } from './modules/messaging/messaging.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { ComplianceModule } from './modules/compliance/compliance.module.js';
import { PayrollModule } from './modules/payroll/payroll.module.js';
import { AssistantModule } from './modules/assistant/assistant.module.js';
import { InsightsModule } from './modules/insights/insights.module.js';
import { ReferralsModule } from './modules/referrals/referrals.module.js';
import { AiModule } from './modules/ai/claude.service.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { VisitDocsModule } from './modules/visit-docs/visit-docs.module.js';

@Module({
  imports: [
    AppConfigModule,
    // General per-IP rate limit; credential endpoints set a stricter one with @Throttle. RATE_LIMITS_DISABLED is only
    // for the CI browser suite (dozens of sign-ins a minute from one IP) and is refused in production.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        skipIf: () => config.get('RATE_LIMITS_DISABLED', { infer: true }),
      }),
    }),
    DatabaseModule,
    CryptoModule,
    AuditModule,
    RbacModule,
    AuthModule,
    UsersModule,
    PatientsModule,
    PhysiciansModule,
    StaffModule,
    SchedulingModule,
    EvvModule,
    IvrModule,
    BillingModule,
    AgencyModule,
    ClinicalModule,
    DocumentsModule,
    MessagingModule,
    PortalModule,
    ComplianceModule,
    PayrollModule,
    AssistantModule,
    InsightsModule,
    ReferralsModule,
    AiModule,
    ReportsModule,
    VisitDocsModule,
    NotificationsModule,
    RealtimeModule,
    ScheduleModule.forRoot(),
    JobsModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limiting runs before authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
