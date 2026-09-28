import { Global, Module } from '@nestjs/common';
import { AgencyClockService } from './agency-clock.service.js';
import { PrismaService } from './prisma.service.js';

/** Import once in AppModule (done by the first feature module that needs the database, P1-06). */
@Global()
@Module({
  providers: [PrismaService, AgencyClockService],
  exports: [PrismaService, AgencyClockService],
})
export class DatabaseModule {}
