import { Module } from '@nestjs/common';
import { AuthorizationsService } from './authorizations.service.js';
import { BillingReadinessService } from './billing-readiness.service.js';
import {
  AuthorizationsController,
  BillingSetupController,
  ClaimsController,
  PaymentsController,
} from './billing.controllers.js';
import { ClaimsService } from './claims.service.js';
import { EdiService } from './edi.service.js';
import { EligibilityController } from './eligibility.controller.js';
import { EligibilityService } from './eligibility.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsService } from './payments.service.js';
import { BillingSetupService } from './billing-setup.service.js';

/** Billing setup and authorizations (DECISIONS D-050). Claims, EDI and payments build on this (P3-03+). */
@Module({
  controllers: [
    BillingSetupController,
    AuthorizationsController,
    ClaimsController,
    PaymentsController,
    InvoicesController,
    EligibilityController,
  ],
  providers: [
    BillingSetupService,
    AuthorizationsService,
    BillingReadinessService,
    ClaimsService,
    EdiService,
    PaymentsService,
    InvoicesService,
    EligibilityService,
  ],
  exports: [BillingSetupService, AuthorizationsService, BillingReadinessService],
})
export class BillingModule {}
