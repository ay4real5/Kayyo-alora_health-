import { Body, Controller, Get, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { BillingModule } from '../billing/billing.module.js';
import { ComplianceModule } from '../compliance/compliance.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { StaffModule } from '../staff/staff.module.js';
import { AssistantService } from './assistant.service.js';
import { AssistantChatDto } from './dto/assistant.dto.js';

/** Each question can make several model calls: keep the per-person rate modest. */
const CHAT_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/** The in-app AI assistant (D-092): read-only answers and lookups, within the caller's own permissions. */
@ApiTags('assistant')
@Permissions('assistant:use')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Whether the assistant is switched on (the dashboard hides it otherwise). */
  @Get('status')
  status() {
    return this.assistant.status();
  }

  @Throttle(CHAT_LIMIT)
  @Audit({ action: 'ASSISTANT_CHAT', resourceType: 'assistant' })
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  chat(@CurrentUser() caller: AuthUser, @Body() dto: AssistantChatDto) {
    return this.assistant.chat(caller, dto);
  }
}

@Module({
  imports: [PatientsModule, StaffModule, SchedulingModule, BillingModule, PayrollModule, ComplianceModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
