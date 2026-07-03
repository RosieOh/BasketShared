import { ConflictException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { FileTransfer, TransferStatus } from './entities/file-transfer.entity';
import { FileTransferRepository } from './file-transfer.repository';
import { TRANSFER_JOB } from './queue/transfer-queue';
import { TransfersService } from './transfers.service';

describe('TransfersService', () => {
  let service: TransfersService;
  let repo: jest.Mocked<Pick<FileTransferRepository, 'findById' | 'resetForRetry' | 'list'>>;
  let queue: jest.Mocked<Pick<Queue, 'add'>>;

  beforeEach(() => {
    repo = { findById: jest.fn(), resetForRetry: jest.fn(), list: jest.fn() };
    queue = { add: jest.fn() };
    service = new TransfersService(
      repo as unknown as FileTransferRepository,
      queue as unknown as Queue,
    );
  });

  it('retries a FAILED transfer: resets it and re-emits the worker event', async () => {
    repo.findById
      .mockResolvedValueOnce({ id: 't1', status: TransferStatus.FAILED } as FileTransfer)
      .mockResolvedValueOnce({ id: 't1', status: TransferStatus.PENDING } as FileTransfer);

    const result = await service.retry('t1');

    expect(repo.resetForRetry).toHaveBeenCalledWith('t1');
    expect(queue.add).toHaveBeenCalledWith(TRANSFER_JOB, { transferId: 't1' });
    expect(result.status).toBe(TransferStatus.PENDING);
  });

  it('refuses to retry an already-successful transfer', async () => {
    repo.findById.mockResolvedValue({ id: 't1', status: TransferStatus.SUCCESS } as FileTransfer);

    await expect(service.retry('t1')).rejects.toBeInstanceOf(ConflictException);
    expect(repo.resetForRetry).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('throws NotFound for an unknown id', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a paginated envelope from list()', async () => {
    repo.list.mockResolvedValue([[{ id: 't1' } as FileTransfer], 1]);
    const res = await service.list({ limit: 20, offset: 0 });
    expect(res).toEqual({ items: [{ id: 't1' }], total: 1, limit: 20, offset: 0 });
  });
});
