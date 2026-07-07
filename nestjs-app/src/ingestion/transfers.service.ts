import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Readable } from 'node:stream';
import { DataSource, EntityManager, LessThan } from 'typeorm';
import { AuthUser } from '../auth/jwt.strategy';
import { Role } from '../auth/role.enum';
import { CryptoService } from '../crypto/crypto.service';
import { StorageService } from '../storage/storage.service';
import { ListTransfersQueryDto } from './dto/list-transfers.query.dto';
import { RetryBatchDto } from './dto/retry-batch.dto';
import { FileTransfer, TransferStatus } from './entities/file-transfer.entity';
import { TRANSFER_JOB, TRANSFER_QUEUE, TransferJobData } from './queue/transfer-queue';

export interface DownloadResult {
  stream: Readable;
  filename: string;
  contentType: string;
}

export interface PaginatedTransfers {
  items: FileTransfer[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Management operations, tenant-isolated via PostgreSQL RLS. Platform admins see
 * everything; tenant users run inside a transaction that sets `app.current_tenant`
 * so the row-level policy filters to their tenant — enforcement is in the DB,
 * not just the app.
 */
@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(TRANSFER_QUEUE) private readonly queue: Queue<TransferJobData>,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
  ) {}

  /** Run `work` with the caller's tenant scope applied (admins bypass). */
  private async scoped<T>(user: AuthUser, work: (mgr: EntityManager) => Promise<T>): Promise<T> {
    if (user.roles.includes(Role.ADMIN)) return work(this.dataSource.manager);
    return this.dataSource.transaction(async (mgr) => {
      // SET LOCAL (transaction-scoped) via set_config, which accepts params.
      await mgr.query(`SELECT set_config('app.current_tenant', $1, true)`, [user.tenantId]);
      return work(mgr);
    });
  }

  async list(query: ListTransfersQueryDto, user: AuthUser): Promise<PaginatedTransfers> {
    return this.scoped(user, async (mgr) => {
      const [items, total] = await mgr.getRepository(FileTransfer).findAndCount({
        where: query.status ? { status: query.status } : {},
        order: { createdAt: 'DESC' },
        take: query.limit,
        skip: query.offset,
      });
      return { items, total, limit: query.limit, offset: query.offset };
    });
  }

  async getById(id: string, user: AuthUser): Promise<FileTransfer> {
    const transfer = await this.scoped(user, (mgr) =>
      mgr.getRepository(FileTransfer).findOne({ where: { id } }),
    );
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found`);
    return transfer;
  }

  /**
   * Stream the stored object back, decrypting on the fly if it was encrypted.
   * Tenant-scoped via getById (RLS), so users can only download their tenant's
   * objects.
   */
  async download(id: string, user: AuthUser): Promise<DownloadResult> {
    const transfer = await this.getById(id, user); // 404s across tenants (RLS)
    if (transfer.status !== TransferStatus.SUCCESS || !transfer.objectKey) {
      throw new ConflictException(`Transfer ${id} has no stored object (status ${transfer.status})`);
    }

    const obj = await this.storage.getObject(transfer.bucket, transfer.objectKey);
    const stream =
      transfer.encrypted && transfer.wrappedDek
        ? obj.body.pipe(this.crypto.createDecryptStream(transfer.wrappedDek))
        : obj.body;

    return {
      stream,
      filename: transfer.filename,
      contentType: obj.contentType ?? 'application/octet-stream',
    };
  }

  async retry(id: string, user: AuthUser): Promise<FileTransfer> {
    const transfer = await this.scoped(user, async (mgr) => {
      const repo = mgr.getRepository(FileTransfer);
      const found = await repo.findOne({ where: { id } });
      if (!found) throw new NotFoundException(`Transfer ${id} not found`);
      if (found.status === TransferStatus.SUCCESS) {
        throw new ConflictException(`Transfer ${id} already succeeded; nothing to retry`);
      }
      await repo.update(id, { status: TransferStatus.PENDING, attempts: 0, errorLog: null });
      return repo.findOneOrFail({ where: { id } });
    });
    await this.queue.add(TRANSFER_JOB, { transferId: id });
    this.logger.log(`Transfer ${id} re-queued via management API`);
    return transfer;
  }

  async retryBatch(dto: RetryBatchDto, user: AuthUser): Promise<{ requeued: number; ids: string[] }> {
    const status = dto.status ?? TransferStatus.FAILED;
    if (status === TransferStatus.SUCCESS) {
      throw new ConflictException('Cannot batch-retry SUCCESS transfers');
    }
    const before = dto.before ? new Date(dto.before) : undefined;

    const ids = await this.scoped(user, async (mgr) => {
      const repo = mgr.getRepository(FileTransfer);
      const matches = await repo.find({
        where: { status, ...(before ? { updatedAt: LessThan(before) } : {}) },
        order: { createdAt: 'ASC' },
        take: dto.limit,
      });
      const collected: string[] = [];
      for (const t of matches) {
        await repo.update(t.id, { status: TransferStatus.PENDING, attempts: 0, errorLog: null });
        collected.push(t.id);
      }
      return collected;
    });

    for (const id of ids) await this.queue.add(TRANSFER_JOB, { transferId: id });
    this.logger.log(`Batch retry re-queued ${ids.length} transfer(s) [status=${status}]`);
    return { requeued: ids.length, ids };
  }
}
