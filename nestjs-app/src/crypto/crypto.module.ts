import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** Global so the worker can encrypt without re-importing. */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
