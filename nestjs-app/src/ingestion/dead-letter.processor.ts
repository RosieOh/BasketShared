import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FileTransferRepository } from './file-transfer.repository';
import { MetricsService } from '../metrics/metrics.service';
import { NotificationService } from '../notifications/notification.service';
import { DEAD_LETTER_QUEUE, DeadLetterJobData } from './queue/transfer-queue';

/**
 * Consumes permanently-failed transfers: records a metric and fires a failure
 * alert. Separating this from the main worker keeps failure handling
 * (notify/review) decoupled from transfer processing.
 */
@Processor(DEAD_LETTER_QUEUE)
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  constructor(
    private readonly repository: FileTransferRepository,
    private readonly notifications: NotificationService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<DeadLetterJobData>): Promise<void> {
    const { transferId, reason } = job.data;
    this.metrics.recordDeadLetter();
    const transfer = await this.repository.findById(transferId);
    this.logger.warn(`Dead-letter: transfer ${transferId} — ${reason}`);
    await this.notifications.notifyFailure({
      transferId,
      filename: transfer?.filename ?? 'unknown',
      reason,
    });
  }
}
