import { Global, Module } from '@nestjs/common';
import { PhiCryptoService } from './phi-crypto.service.js';

@Global()
@Module({
  providers: [PhiCryptoService],
  exports: [PhiCryptoService],
})
export class CryptoModule {}
