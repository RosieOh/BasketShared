import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { StorageService } from '../storage/storage.service';

/** Terminus indicator that verifies the configured bucket is reachable. */
@Injectable()
export class S3HealthIndicator extends HealthIndicator {
  constructor(private readonly storage: StorageService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.storage.checkBucket();
      return this.getStatus(key, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError('S3 bucket unreachable', this.getStatus(key, false, { message }));
    }
  }
}
