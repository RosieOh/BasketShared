import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Interval } from '@nestjs/schedule';
import type { AppConfig } from '../config/configuration';
import { FileTransferRepository } from './file-transfer.repository';
import { TRANSFER_JOB, TRANSFER_QUEUE, TransferJobData } from './queue/transfer-queue';

/**
 * Periodically re-drives transfers abandoned by a crash or restart.
 *
 * The in-process event worker is fast and survives restarts (PENDING rows
 * persist), but a crash mid-flight can leave a row stuck in PENDING/PROCESSING
 * with no one to resume it. This sweeper closes that gap, giving the pipeline
 * effective at-least-once delivery. Rows whose retries are already exhausted are
 * finalized as FAILED instead of being re-driven forever.
 */
@Injectable()
export class RecoveryService implements OnModuleInit {
  private readonly logger = new Logger(RecoveryService.name);
  private readonly enabled: boolean;
  private readonly staleMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private running = false;

  constructor(
    private readonly repository: FileTransferRepository,
    @InjectQueue(TRANSFER_QUEUE) private readonly queue: Queue<TransferJobData>,
    config: ConfigService<AppConfig, true>,
  ) {
    const recovery = config.get('recovery', { infer: true });
    this.enabled = recovery.enabled;
    this.staleMs = recovery.staleMs;
    this.batchSize = recovery.batchSize;
    this.maxAttempts = config.get('app.transferMaxAttempts', { infer: true });
  }

  onModuleInit(): void {
    this.logger.log(
      this.enabled
        ? `Stuck-transfer recovery enabled (stale>${this.staleMs}ms, batch=${this.batchSize})`
        : 'Stuck-transfer recovery disabled',
    );
  }

  @Interval('stuck-transfer-recovery', 60_000)
  async sweep(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const staleBefore = new Date(Date.now() - this.staleMs);
      const stuck = await this.repository.findStuck(staleBefore, this.batchSize);
      if (stuck.length === 0) return;

      let requeued = 0;
      let failed = 0;
      for (const transfer of stuck) {
        if (transfer.attempts >= this.maxAttempts) {
          await this.repository.markFailed(
            transfer.id,
            `Recovered after interruption but retries (${transfer.attempts}) already exhausted`,
          );
          failed++;
        } else {
          await this.queue.add(TRANSFER_JOB, { transferId: transfer.id });
          requeued++;
        }
      }
      this.logger.warn(
        `Recovery sweep: ${stuck.length} stuck transfer(s) — re-queued ${requeued}, failed ${failed}`,
      );
    } catch (err) {
      this.logger.error(`Recovery sweep error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
