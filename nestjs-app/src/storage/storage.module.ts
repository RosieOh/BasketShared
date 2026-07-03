import { Global, Module } from '@nestjs/common';
import { s3ClientProvider } from './s3-client.provider';
import { StorageService } from './storage.service';

/**
 * Global so any feature module can inject StorageService without re-importing.
 * Only the service is exported — the raw S3 client stays an internal detail.
 */
@Global()
@Module({
  providers: [s3ClientProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
