import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { AppConfig } from '../config/configuration';
import { computeFileChecksums } from '../common/checksum.util';
import { NonRetryableError } from '../common/non-retryable.error';
import { TransferStatus } from './entities/file-transfer.entity';
import { FileTransferRepository } from './file-transfer.repository';
import { MetricsService } from '../metrics/metrics.service';
import { ProcessingPipeline } from './pipeline/processing-pipeline';
import { StorageService } from '../storage/storage.service';
import { TRANSFER_QUEUE, TransferJobData } from './queue/transfer-queue';

/** Single-part S3 ETags are the hex MD5 of the body (no "-<parts>" suffix). */
const SINGLE_PART_ETAG = /^[0-9a-f]{32}$/i;

/**
 * BullMQ worker that performs the SFTPGo -> S3 transfer.
 *
 * Retries and concurrency are delegated to BullMQ:
 *   - transient failures throw; BullMQ re-runs the job with exponential backoff
 *     (attempts/backoff come from the queue's defaultJobOptions),
 *   - fatal, non-retryable problems (missing source) mark the row FAILED and
 *     return so no pointless retries happen,
 *   - the `failed` event finalizes a row to FAILED once retries are exhausted.
 * Because the queue lives in Redis, jobs survive restarts and scale across
 * multiple orchestrator instances.
 */
@Processor(TRANSFER_QUEUE)
export class IngestionProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(IngestionProcessor.name);
  private readonly concurrency: number;

  constructor(
    private readonly repository: FileTransferRepository,
    private readonly storage: StorageService,
    private readonly pipeline: ProcessingPipeline,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    super();
    this.concurrency = config.get('app.workerConcurrency', { infer: true });
  }

  onModuleInit(): void {
    // Concurrency isn't known at decoration time; set it on the live worker.
    this.worker.concurrency = this.concurrency;
  }

  async process(job: Job<TransferJobData>): Promise<void> {
    const { transferId } = job.data;
    const transfer = await this.repository.findById(transferId);
    if (!transfer) {
      this.logger.error(`Transfer ${transferId} not found; dropping job`);
      return;
    }
    if (transfer.status === TransferStatus.SUCCESS) {
      this.logger.debug(`Transfer ${transfer.id} already SUCCESS; skipping`);
      return;
    }

    const endTimer = this.metrics.startTimer();
    this.metrics.incInFlight();
    await this.repository.markProcessing(transfer.id);

    try {
      const stats = await stat(transfer.sourcePath).catch(() => null);
      if (!stats || !stats.isFile()) {
        throw new NonRetryableError(`Source unreadable: ${transfer.sourcePath}`);
      }

      // Pluggable pre-upload stages: validation -> antivirus -> enrichment.
      const ctx = {
        transfer,
        sourcePath: transfer.sourcePath,
        sizeBytes: stats.size,
        metadata: {} as { contentType?: string; [k: string]: unknown },
      };
      await this.pipeline.run(ctx);

      const checksums = await computeFileChecksums(ctx.sourcePath);
      const result = await this.storage.uploadStream({
        key: this.buildObjectKey(transfer),
        body: createReadStream(ctx.sourcePath),
        contentLength: ctx.sizeBytes,
        contentType: ctx.metadata.contentType ?? 'application/octet-stream',
      });
      this.verifyIntegrity(result.etag, checksums.md5);

      await this.repository.markSuccess(transfer.id, result.key, result.etag ?? null, checksums.sha256);
      this.metrics.recordSuccess(ctx.sizeBytes);
      this.logger.log(
        `Transfer ${transfer.id} SUCCESS (attempt ${job.attemptsMade + 1}) -> ` +
          `s3://${result.bucket}/${result.key} (type=${ctx.metadata.contentType}, ` +
          `etag=${result.etag ?? 'n/a'}, sha256=${checksums.sha256})`,
      );
    } catch (err) {
      if (err instanceof NonRetryableError) {
        // Permanent: finalize now, don't hand back to BullMQ for retries.
        this.logger.error(`Transfer ${transfer.id} rejected: ${err.message}`);
        await this.repository.markFailed(transfer.id, err.message);
        this.metrics.recordFailure();
        return;
      }
      // Transient: let BullMQ retry. Finalization happens in onFailed.
      this.logger.warn(
        `Transfer ${transfer.id} attempt ${job.attemptsMade + 1} failed: ${this.errMessage(err)}`,
      );
      throw err;
    } finally {
      this.metrics.decInFlight();
      endTimer();
    }
  }

  /** Fired per failed attempt; finalize the DB row once retries are exhausted. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<TransferJobData>, err: Error): Promise<void> {
    const totalAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < totalAttempts) return; // more retries pending
    const message = `Exhausted ${totalAttempts} attempts. Last error: ${this.errMessage(err)}`;
    this.logger.error(`Transfer ${job.data.transferId} FAILED. ${message}`);
    await this.repository.markFailed(job.data.transferId, message);
    this.metrics.recordFailure();
  }

  /**
   * For single-part uploads the ETag is the object's MD5, so we can confirm the
   * bytes S3 stored match what we read. Multipart ETags aren't a plain MD5, so
   * they're skipped (the SHA-256 record still provides end-to-end integrity).
   */
  private verifyIntegrity(etag: string | undefined, expectedMd5: string): void {
    if (etag && SINGLE_PART_ETAG.test(etag) && etag.toLowerCase() !== expectedMd5.toLowerCase()) {
      throw new Error(`Integrity check failed: ETag ${etag} != source MD5 ${expectedMd5}`);
    }
  }

  private buildObjectKey(transfer: { username: string; virtualPath: string }): string {
    const relative = transfer.virtualPath.replace(/^\/+/, '');
    return `${transfer.username}/${relative}`;
  }

  private errMessage(err: unknown): string {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
}
