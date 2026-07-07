import { FileTransfer } from './entities/file-transfer.entity';
import { OutboxService } from '../outbox/outbox.service';
import { TenantService } from '../tenancy/tenant.service';
import { AcceptOutcome, IngestionService } from './ingestion.service';
import { SftpgoWebhookDto } from './dto/sftpgo-webhook.dto';

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
  let outbox: jest.Mocked<Pick<OutboxService, 'createTransferWithOutbox'>>;

  beforeEach(() => {
    outbox = { createTransferWithOutbox: jest.fn() };

    const config = {
      get: (key: string) =>
        key === 'app.ingestionDataRoot' ? DATA_ROOT : key === 's3.bucket' ? 'test-bucket' : undefined,
    };

    const tenants = { resolve: () => 'default' } as unknown as TenantService;
    service = new IngestionService(outbox as unknown as OutboxService, tenants, config as never);
  });

  it('accepts a valid upload and persists it atomically via the outbox', async () => {
    outbox.createTransferWithOutbox.mockResolvedValue({ id: 'transfer-1' } as FileTransfer);

    const outcome = await service.accept(buildPayload());

    expect(outcome).toBe(AcceptOutcome.ACCEPTED);
    expect(outbox.createTransferWithOutbox).toHaveBeenCalledTimes(1);
    expect(outbox.createTransferWithOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice', virtualPath: '/report.csv' }),
      expect.any(Object),
    );
  });

  it('treats a duplicate webhook (unique-key collision) as a no-op', async () => {
    outbox.createTransferWithOutbox.mockResolvedValue(null);

    const outcome = await service.accept(buildPayload());

    expect(outcome).toBe(AcceptOutcome.DUPLICATE);
  });

  it('ignores non-upload actions', async () => {
    const outcome = await service.accept(buildPayload({ action: 'download' }));
    expect(outcome).toBe(AcceptOutcome.IGNORED);
    expect(outbox.createTransferWithOutbox).not.toHaveBeenCalled();
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
    expect(outbox.createTransferWithOutbox).not.toHaveBeenCalled();
  });
});
