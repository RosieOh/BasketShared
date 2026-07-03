import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { FileTransfer, TransferStatus } from './entities/file-transfer.entity';
import { FileTransferRepository } from './file-transfer.repository';
import { ListTransfersQueryDto } from './dto/list-transfers.query.dto';
import { TRANSFER_JOB, TRANSFER_QUEUE, TransferJobData } from './queue/transfer-queue';

export interface PaginatedTransfers {
  items: FileTransfer[];
  total: number;
  limit: number;
  offset: number;
}

/** Read + operations for the management API (list, inspect, retry). */
@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly repository: FileTransferRepository,
    @InjectQueue(TRANSFER_QUEUE) private readonly queue: Queue<TransferJobData>,
  ) {}

  async list(query: ListTransfersQueryDto): Promise<PaginatedTransfers> {
    const [items, total] = await this.repository.list(query);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async getById(id: string): Promise<FileTransfer> {
    const transfer = await this.repository.findById(id);
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found`);
    return transfer;
  }

  /**
   * Re-drive a transfer: reset it to PENDING (attempts=0) and re-emit the worker
   * event. Refuses an already-successful transfer to avoid pointless re-uploads.
   */
  async retry(id: string): Promise<FileTransfer> {
    const transfer = await this.repository.findById(id);
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found`);
    if (transfer.status === TransferStatus.SUCCESS) {
      throw new ConflictException(`Transfer ${id} already succeeded; nothing to retry`);
    }

    await this.repository.resetForRetry(id);
    await this.queue.add(TRANSFER_JOB, { transferId: id });
    this.logger.log(`Transfer ${id} manually re-queued via management API`);
    return this.getById(id);
  }
}
