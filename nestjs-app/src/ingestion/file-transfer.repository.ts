import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, QueryFailedError, Repository } from 'typeorm';
import { FileTransfer, TransferStatus } from './entities/file-transfer.entity';

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

export interface CreatePendingInput {
  idempotencyKey: string;
  filename: string;
  virtualPath: string;
  sourcePath: string;
  bucket: string;
  sizeBytes: string;
  username: string;
  protocol?: string;
  sessionId?: string;
}

/**
 * Data-access boundary for FileTransfer. Encapsulates persistence concerns
 * (including the idempotent insert) so services stay free of ORM specifics.
 */
@Injectable()
export class FileTransferRepository {
  constructor(
    @InjectRepository(FileTransfer)
    private readonly repo: Repository<FileTransfer>,
  ) {}

  /**
   * Insert a PENDING transfer. Returns the row on success, or `null` when the
   * idempotency key already exists (duplicate webhook) — letting the caller
   * short-circuit without re-processing.
   */
  async createPendingIfAbsent(input: CreatePendingInput): Promise<FileTransfer | null> {
    const entity = this.repo.create({ ...input, status: TransferStatus.PENDING, attempts: 0 });
    try {
      return await this.repo.save(entity);
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        return null;
      }
      throw err;
    }
  }

  findById(id: string): Promise<FileTransfer | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Atomically claim the row for processing and bump the attempt counter. */
  async markProcessing(id: string): Promise<void> {
    await this.repo.update(id, {
      status: TransferStatus.PROCESSING,
      attempts: () => '"attempts" + 1',
      errorLog: null,
    });
  }

  async markSuccess(
    id: string,
    objectKey: string,
    etag: string | null,
    checksumSha256: string | null,
  ): Promise<void> {
    await this.repo.update(id, {
      status: TransferStatus.SUCCESS,
      objectKey,
      etag,
      checksumSha256,
      errorLog: null,
    });
  }

  async markFailed(id: string, errorLog: string): Promise<void> {
    await this.repo.update(id, { status: TransferStatus.FAILED, errorLog });
  }

  /** Reset a transfer so the worker will process it from scratch. */
  async resetForRetry(id: string): Promise<void> {
    await this.repo.update(id, {
      status: TransferStatus.PENDING,
      attempts: 0,
      errorLog: null,
    });
  }

  /** Paginated listing for the management API, newest first, optional status. */
  list(params: {
    status?: TransferStatus;
    limit: number;
    offset: number;
  }): Promise<[FileTransfer[], number]> {
    return this.repo.findAndCount({
      where: params.status ? { status: params.status } : {},
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
  }

  /**
   * Rows abandoned by a crash/restart: still PENDING or PROCESSING and not
   * touched since `staleBefore`. Oldest first, capped at `limit`.
   */
  findStuck(staleBefore: Date, limit: number): Promise<FileTransfer[]> {
    return this.repo.find({
      where: {
        status: In([TransferStatus.PENDING, TransferStatus.PROCESSING]),
        updatedAt: LessThan(staleBefore),
      },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
  }
}
