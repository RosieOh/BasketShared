import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from '../config/configuration';
import { EventsModule } from '../events/events.module';
import { OutboxModule } from '../outbox/outbox.module';
import { DEAD_LETTER_QUEUE, TRANSFER_QUEUE } from './queue/transfer-queue';
import { DeadLetterProcessor } from './dead-letter.processor';
import { FileTransfer } from './entities/file-transfer.entity';
import { FileTransferRepository } from './file-transfer.repository';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionService } from './ingestion.service';
import { RecoveryService } from './recovery.service';
import { RetentionService } from './retention.service';
import { RoutingService } from './routing.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { AntivirusStep } from './pipeline/antivirus.step';
import { ContentTypeStep } from './pipeline/content-type.step';
import { ProcessingPipeline } from './pipeline/processing-pipeline';
import { PROCESSING_STEPS } from './pipeline/processing-step';
import { QuotaStep } from './pipeline/quota.step';
import { ValidationStep } from './pipeline/validation.step';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileTransfer]),
    BullModule.registerQueueAsync({
      name: TRANSFER_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const app = config.get('app', { infer: true });
        return {
          defaultJobOptions: {
            attempts: app.transferMaxAttempts,
            backoff: { type: 'exponential', delay: app.transferRetryBackoffMs },
            removeOnComplete: 1000, // keep a recent window for inspection
            removeOnFail: false, // retain failed jobs for debugging
          },
        };
      },
    }),
    BullModule.registerQueue({ name: DEAD_LETTER_QUEUE }),
    OutboxModule,
    EventsModule,
  ],
  controllers: [IngestionController, TransfersController],
  providers: [
    IngestionService,
    IngestionProcessor,
    DeadLetterProcessor,
    FileTransferRepository,
    RecoveryService,
    RetentionService,
    RoutingService,
    TransfersService,
    // Processing pipeline: steps + ordered assembly.
    ValidationStep,
    QuotaStep,
    AntivirusStep,
    ContentTypeStep,
    ProcessingPipeline,
    {
      provide: PROCESSING_STEPS,
      inject: [ValidationStep, QuotaStep, AntivirusStep, ContentTypeStep],
      useFactory: (
        validation: ValidationStep,
        quota: QuotaStep,
        antivirus: AntivirusStep,
        contentType: ContentTypeStep,
      ) => [validation, quota, antivirus, contentType],
    },
  ],
})
export class IngestionModule {}
