import { ConfigService } from '@nestjs/config';
import { FileTransfer } from './entities/file-transfer.entity';
import { RoutingService } from './routing.service';
import type { RoutingRule } from '../config/configuration';

function makeService(rules: RoutingRule[]): RoutingService {
  const config = {
    get: (key: string) => (key === 's3.bucket' ? 'default-bucket' : rules),
  } as unknown as ConfigService<Record<string, unknown>, true>;
  return new RoutingService(config as never);
}

const transfer = (over: Partial<FileTransfer> = {}): FileTransfer =>
  ({ username: 'alice', filename: 'report.csv', virtualPath: '/report.csv', ...over }) as FileTransfer;

describe('RoutingService', () => {
  it('falls back to the default bucket when no rules match', () => {
    const svc = makeService([]);
    expect(svc.resolve(transfer())).toEqual({ bucket: 'default-bucket', key: 'alice/report.csv' });
  });

  it('routes by extension to a custom bucket + prefix (first match wins)', () => {
    const svc = makeService([
      { match: { extension: 'csv' }, bucket: 'csv-archive', prefix: 'in/' },
      { match: {}, bucket: 'catch-all' },
    ]);
    expect(svc.resolve(transfer())).toEqual({ bucket: 'csv-archive', key: 'in/alice/report.csv' });
  });

  it('routes by username', () => {
    const svc = makeService([{ match: { username: 'bob' }, bucket: 'bob-bucket' }]);
    expect(svc.resolve(transfer({ username: 'bob', virtualPath: '/x.txt' }))).toEqual({
      bucket: 'bob-bucket',
      key: 'bob/x.txt',
    });
  });

  it('does not match a rule whose extension differs', () => {
    const svc = makeService([{ match: { extension: 'pdf' }, bucket: 'pdf-bucket' }]);
    expect(svc.resolve(transfer()).bucket).toBe('default-bucket');
  });
});
