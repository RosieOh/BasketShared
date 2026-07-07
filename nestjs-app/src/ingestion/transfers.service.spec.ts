import { ConflictException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/jwt.strategy';
import { Role } from '../auth/role.enum';
import { FileTransfer, TransferStatus } from './entities/file-transfer.entity';
import { TRANSFER_JOB } from './queue/transfer-queue';
import { TransfersService } from './transfers.service';

const ADMIN: AuthUser = { userId: 'u1', username: 'admin', roles: [Role.ADMIN], tenantId: 'default' };

describe('TransfersService', () => {
  let service: TransfersService;
  let repo: { findOne: jest.Mock; findOneOrFail: jest.Mock; update: jest.Mock; findAndCount: jest.Mock };
  let queue: jest.Mocked<Pick<Queue, 'add'>>;

  beforeEach(() => {
    repo = { findOne: jest.fn(), findOneOrFail: jest.fn(), update: jest.fn(), findAndCount: jest.fn() };
    // Admin path uses dataSource.manager directly (no tenant transaction).
    const dataSource = { manager: { getRepository: () => repo } } as unknown as DataSource;
    queue = { add: jest.fn() };
    service = new TransfersService(dataSource, queue as unknown as Queue, {} as never, {} as never);
  });

  it('retries a FAILED transfer: resets it and re-queues the worker', async () => {
    repo.findOne.mockResolvedValue({ id: 't1', status: TransferStatus.FAILED } as FileTransfer);
    repo.findOneOrFail.mockResolvedValue({ id: 't1', status: TransferStatus.PENDING } as FileTransfer);

    const result = await service.retry('t1', ADMIN);

    expect(repo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ status: TransferStatus.PENDING, attempts: 0 }));
    expect(queue.add).toHaveBeenCalledWith(TRANSFER_JOB, { transferId: 't1' });
    expect(result.status).toBe(TransferStatus.PENDING);
  });

  it('refuses to retry an already-successful transfer', async () => {
    repo.findOne.mockResolvedValue({ id: 't1', status: TransferStatus.SUCCESS } as FileTransfer);
    await expect(service.retry('t1', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('throws NotFound for an unknown id', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.getById('missing', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a paginated envelope from list()', async () => {
    repo.findAndCount.mockResolvedValue([[{ id: 't1' } as FileTransfer], 1]);
    const res = await service.list({ limit: 20, offset: 0 }, ADMIN);
    expect(res).toEqual({ items: [{ id: 't1' }], total: 1, limit: 20, offset: 0 });
  });
});
