import { Module } from '@nestjs/common';
import { EvvModule } from '../evv/evv.module.js';
import { IvrController } from './ivr.controller.js';
import { IvrService } from './ivr.service.js';

/** Telephony EVV over Twilio Voice webhooks (D-073). */
@Module({
  imports: [EvvModule],
  controllers: [IvrController],
  providers: [IvrService],
})
export class IvrModule {}
