import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { Queue } from 'bullmq';
import { TRANSFER_QUEUE } from '../ingestion/queue/transfer-queue';

/** Terminus indicator that PINGs the Redis backing the BullMQ queue. */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@InjectQueue(TRANSFER_QUEUE) private readonly queue: Queue) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = (await this.queue.client) as unknown as { ping(): Promise<string> };
      await client.ping();
      return this.getStatus(key, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError('Redis unreachable', this.getStatus(key, false, { message }));
    }
  }
}
