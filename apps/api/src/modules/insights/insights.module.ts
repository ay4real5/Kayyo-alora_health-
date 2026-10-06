import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { BillingModule } from '../billing/billing.module.js';
import { InsightsService } from './insights.service.js';

/** The Command Center (D-093). Any signed-in staff member; each section needs its own permission. */
@ApiTags('insights')
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('command-center')
  commandCenter(@CurrentUser() caller: AuthUser) {
    return this.insights.commandCenter(caller);
  }
}

@Module({
  imports: [BillingModule],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
