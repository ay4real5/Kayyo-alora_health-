import { Module } from '@nestjs/common';
import { AuthorizationsService } from './authorizations.service.js';
import { BillingReadinessService } from './billing-readiness.service.js';
import { AuthorizationsController, BillingSetupController } from './billing.controllers.js';
import { BillingSetupService } from './billing-setup.service.js';

/** Billing setup and authorizations (DECISIONS D-050). Claims, EDI and payments build on this (P3-03+). */
@Module({
  controllers: [BillingSetupController, AuthorizationsController],
  providers: [BillingSetupService, AuthorizationsService, BillingReadinessService],
  exports: [BillingSetupService, AuthorizationsService, BillingReadinessService],
})
export class BillingModule {}
