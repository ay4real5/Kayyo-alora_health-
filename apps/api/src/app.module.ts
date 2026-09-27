import { Module } from '@nestjs/common';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [AppConfigModule, CryptoModule, HealthModule],
})
export class AppModule {}
