import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { DataSource, QueryFailedError } from 'typeorm';
import { FileTransfer, TransferStatus } from '../ingestion/entities/file-transfer.entity';
import { CreatePendingInput } from '../ingestion/file-transfer.repository';
import { TRANSFER_JOB, TRANSFER_QUEUE, TransferJobData } from '../ingestion/queue/transfer-queue';
import { OutboxEvent, OutboxStatus } from './outbox-event.entity';

const PG_UNIQUE_VIOLATION = '23505';
const RELAY_BATCH = 100;

/**
 * Transactional outbox: writes the domain row and the "enqueue" intent in one
 * DB transaction, then a relay publishes committed events to BullMQ. Solves the
 * dual-write problem — no more "row persisted but job lost" (or vice-versa)
 * window between the DB insert and queue.add.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private relaying = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(TRANSFER_QUEUE) private readonly queue: Queue<TransferJobData>,
  ) {}

  /**
   * Persist a PENDING transfer AND its outbox event atomically. Returns the row,
   * or null if the idempotency key already exists (duplicate webhook).
   */
  async createTransferWithOutbox(
    input: CreatePendingInput,
    carrier: Record<string, string>,
  ): Promise<FileTransfer | null> {
    try {
      return await this.dataSource.transaction(async (mgr) => {
        const saved = await mgr.save(
          mgr.create(FileTransfer, { ...input, status: TransferStatus.PENDING, attempts: 0 }),
        );
        await mgr.save(
          mgr.create(OutboxEvent, {
            aggregateId: saved.id,
            type: TRANSFER_JOB,
            payload: { transferId: saved.id, carrier } satisfies TransferJobData,
            status: OutboxStatus.PENDING,
          }),
        );
        return saved;
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string })?.code === PG_UNIQUE_VIOLATION
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Poll committed PENDING events and publish them to the queue. Publishing then
   * marking PUBLISHED is at-least-once: a crash between the two re-publishes,
   * and the idempotent worker (SUCCESS short-circuit) absorbs the duplicate.
   */
  @Interval('outbox-relay', 1000)
  async relay(): Promise<void> {
    if (this.relaying) return;
    this.relaying = true;
    try {
      const repo = this.dataSource.getRepository(OutboxEvent);
      const pending = await repo.find({
        where: { status: OutboxStatus.PENDING },
        order: { createdAt: 'ASC' },
        take: RELAY_BATCH,
      });
      for (const evt of pending) {
        await this.queue.add(evt.type, evt.payload as unknown as TransferJobData);
        await repo.update(evt.id, {
          status: OutboxStatus.PUBLISHED,
          publishedAt: new Date(),
          attempts: () => '"attempts" + 1',
        });
      }
      if (pending.length > 0) this.logger.debug(`Outbox relayed ${pending.length} event(s)`);
    } catch (err) {
      this.logger.error(`Outbox relay error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.relaying = false;
    }
  }
}
