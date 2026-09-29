import { Global, Module } from '@nestjs/common';
import { NotificationDeliveryService } from './delivery/delivery.service.js';
import { EmailSender, PushSender, SmsSender } from './delivery/senders.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/** Global so any module can inject NotificationsService and call notify(). */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationDeliveryService, PushSender, SmsSender, EmailSender],
  exports: [NotificationsService, NotificationDeliveryService],
})
export class NotificationsModule {}
