import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AppConfig } from '../config/configuration';
import { SftpgoWebhookDto } from './dto/sftpgo-webhook.dto';
import { FileTransferRepository } from './file-transfer.repository';
import { TRANSFER_JOB, TRANSFER_QUEUE, TransferJobData } from './queue/transfer-queue';

/** SFTPGo status code for a successful operation. */
const SFTPGO_STATUS_OK = 1;

export enum AcceptOutcome {
  ACCEPTED = 'accepted',
  DUPLICATE = 'duplicate',
  IGNORED = 'ignored',
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly dataRoot: string;
  private readonly bucket: string;

  constructor(
    private readonly repository: FileTransferRepository,
    @InjectQueue(TRANSFER_QUEUE) private readonly queue: Queue<TransferJobData>,
    config: ConfigService<AppConfig, true>,
  ) {
    this.dataRoot = resolve(config.get('app.ingestionDataRoot', { infer: true }));
    this.bucket = config.get('s3.bucket', { infer: true });
  }

  /**
   * Validate the event, persist a PENDING record idempotently, and hand off to
   * the background worker. Returns fast so the controller can ack immediately.
   */
  async accept(payload: SftpgoWebhookDto): Promise<AcceptOutcome> {
    // Only successful uploads are actionable.
    if (payload.action !== 'upload') {
      this.logger.debug(`Ignoring non-upload action "${payload.action}"`);
      return AcceptOutcome.IGNORED;
    }
    if (payload.status !== undefined && payload.status !== SFTPGO_STATUS_OK) {
      this.logger.warn(`Ignoring failed upload (status=${payload.status}) for ${payload.virtual_path}`);
      return AcceptOutcome.IGNORED;
    }

    const sourcePath = this.resolveWithinRoot(payload.path);
    if (!sourcePath) {
      this.logger.error(`Rejected path outside data root: ${payload.path}`);
      return AcceptOutcome.IGNORED;
    }

    const idempotencyKey = this.buildIdempotencyKey(payload);

    const record = await this.repository.createPendingIfAbsent({
      idempotencyKey,
      filename: this.basename(payload.virtual_path),
      virtualPath: payload.virtual_path,
      sourcePath,
      bucket: this.bucket,
      sizeBytes: String(payload.file_size ?? 0),
      username: payload.username,
      protocol: payload.protocol,
      sessionId: payload.session_id,
    });

    if (!record) {
      this.logger.log(`Duplicate webhook ignored for ${payload.virtual_path} (key=${idempotencyKey})`);
      return AcceptOutcome.DUPLICATE;
    }

    this.logger.log(`Accepted upload ${payload.virtual_path} -> transfer ${record.id}`);
    // Enqueue for the worker; the controller returns without awaiting processing.
    await this.queue.add(TRANSFER_JOB, { transferId: record.id });
    return AcceptOutcome.ACCEPTED;
  }

  /**
   * Stable hash uniquely identifying one upload event. Re-deliveries of the
   * same event produce the same key and collide on the unique index.
   */
  private buildIdempotencyKey(p: SftpgoWebhookDto): string {
    return createHash('sha256')
      .update([p.username, p.virtual_path, p.file_size, p.timestamp ?? '', p.session_id ?? ''].join('|'))
      .digest('hex');
  }

  /**
   * Resolve `candidate` and confirm it stays within the configured data root.
   * Defends against path-traversal in a payload we ultimately read from disk.
   * Returns the normalized absolute path, or null if it escapes the root.
   */
  private resolveWithinRoot(candidate: string): string | null {
    if (!candidate || !isAbsolute(candidate)) return null;
    const normalized = resolve(candidate);
    const rel = relative(this.dataRoot, normalized);
    const escapes = rel.startsWith('..') || isAbsolute(rel);
    return escapes ? null : normalized;
  }

  private basename(p: string): string {
    const parts = p.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? p;
  }
}
