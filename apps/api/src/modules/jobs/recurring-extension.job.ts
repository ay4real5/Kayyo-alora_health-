import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { RecurringService } from '../scheduling/recurring.service.js';

/** Nightly: extend every active recurring series to the 28-day window (D-031, D-041). */
@Injectable()
export class RecurringExtensionJob {
  private readonly logger = new Logger(RecurringExtensionJob.name);

  constructor(
    private readonly recurring: RecurringService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // 08:15 UTC — overnight in the US, off the top of the hour.
  @Cron('15 8 * * *', { name: 'recurring-extension' })
  async run(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) return;
    try {
      const result = await this.recurring.extendAllActive();
      this.logger.log(
        `recurring: ${result.rules} series, ${result.created} visits created, ${result.skipped} skipped`,
      );
    } catch (error) {
      this.logger.error('recurring extension failed', (error as Error).stack);
    }
  }
}
