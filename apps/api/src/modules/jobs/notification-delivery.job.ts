import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { NotificationDeliveryService } from '../notifications/delivery/delivery.service.js';

/** Every 30 seconds: send queued push / SMS / email deliveries (D-071). Safe with several instances (SKIP LOCKED). */
@Injectable()
export class NotificationDeliveryJob {
  private readonly logger = new Logger(NotificationDeliveryJob.name);
  private running = false;

  constructor(
    private readonly delivery: NotificationDeliveryService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Cron('*/30 * * * * *', { name: 'notification-delivery' })
  async run(): Promise<void> {
    if (!this.config.get('JOBS_ENABLED', { infer: true }) || this.running) return;
    this.running = true;
    try {
      await this.delivery.run();
    } catch (error) {
      this.logger.error('notification delivery failed', (error as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
