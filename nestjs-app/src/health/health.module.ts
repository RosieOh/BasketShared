import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { TRANSFER_QUEUE } from '../ingestion/queue/transfer-queue';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health-indicator';
import { S3HealthIndicator } from './s3.health-indicator';

@Module({
  imports: [TerminusModule, BullModule.registerQueue({ name: TRANSFER_QUEUE })],
  controllers: [HealthController],
  providers: [S3HealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
