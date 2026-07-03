import { Queue } from 'bullmq';
import { FileTransfer } from './entities/file-transfer.entity';
import { FileTransferRepository } from './file-transfer.repository';
import { AcceptOutcome, IngestionService } from './ingestion.service';
import { SftpgoWebhookDto } from './dto/sftpgo-webhook.dto';
import { TRANSFER_JOB } from './queue/transfer-queue';

const DATA_ROOT = '/srv/sftpgo/data';

function buildPayload(overrides: Partial<SftpgoWebhookDto> = {}): SftpgoWebhookDto {
  return {
    action: 'upload',
    username: 'alice',
    path: `${DATA_ROOT}/alice/report.csv`,
    virtual_path: '/report.csv',
    file_size: 1024,
    status: 1,
    protocol: 'SFTP',
    session_id: 'sess-1',
    timestamp: 1719800000000000000,
    ...overrides,
  };
}

describe('IngestionService', () => {
  let service: IngestionService;
  let repository: jest.Mocked<Pick<FileTransferRepository, 'createPendingIfAbsent'>>;
  let queue: jest.Mocked<Pick<Queue, 'add'>>;

  beforeEach(() => {
    repository = { createPendingIfAbsent: jest.fn() };
    queue = { add: jest.fn() };

    const config = {
      get: (key: string) =>
        key === 'app.ingestionDataRoot' ? DATA_ROOT : key === 's3.bucket' ? 'test-bucket' : undefined,
    };

    service = new IngestionService(
      repository as unknown as FileTransferRepository,
      queue as unknown as Queue,
      config as never,
    );
  });

  it('accepts a valid upload, persists it, and emits the worker event', async () => {
    repository.createPendingIfAbsent.mockResolvedValue({ id: 'transfer-1' } as FileTransfer);

    const outcome = await service.accept(buildPayload());

    expect(outcome).toBe(AcceptOutcome.ACCEPTED);
    expect(repository.createPendingIfAbsent).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(TRANSFER_JOB, { transferId: 'transfer-1' });
  });

  it('treats a duplicate webhook (unique-key collision) as a no-op', async () => {
    repository.createPendingIfAbsent.mockResolvedValue(null);

    const outcome = await service.accept(buildPayload());

    expect(outcome).toBe(AcceptOutcome.DUPLICATE);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('ignores non-upload actions', async () => {
    const outcome = await service.accept(buildPayload({ action: 'download' }));
    expect(outcome).toBe(AcceptOutcome.IGNORED);
    expect(repository.createPendingIfAbsent).not.toHaveBeenCalled();
  });

  it('ignores uploads that did not succeed (status != 1)', async () => {
    const outcome = await service.accept(buildPayload({ status: 2 }));
    expect(outcome).toBe(AcceptOutcome.IGNORED);
  });

  it('rejects a path that escapes the data root (traversal defense)', async () => {
    const outcome = await service.accept(
      buildPayload({ path: `${DATA_ROOT}/../../etc/passwd` }),
    );
    expect(outcome).toBe(AcceptOutcome.IGNORED);
    expect(repository.createPendingIfAbsent).not.toHaveBeenCalled();
  });
});
