import { NonRetryableError } from '../../common/non-retryable.error';
import { FileTransfer } from '../entities/file-transfer.entity';
import { ContentTypeStep } from './content-type.step';
import { ProcessingContext } from './processing-step';
import { ValidationStep } from './validation.step';

function ctx(overrides: Partial<ProcessingContext> = {}): ProcessingContext {
  return {
    transfer: { filename: 'report.csv' } as FileTransfer,
    sourcePath: '/data/report.csv',
    sizeBytes: 100,
    metadata: {},
    ...overrides,
  };
}

const configWithMax = (maxBytes: number) => ({ get: () => maxBytes }) as never;

describe('ValidationStep', () => {
  it('passes a normal file', async () => {
    const step = new ValidationStep(configWithMax(1000));
    await expect(step.execute(ctx({ sizeBytes: 500 }))).resolves.toBeUndefined();
  });

  it('rejects an empty file (non-retryable)', async () => {
    const step = new ValidationStep(configWithMax(1000));
    await expect(step.execute(ctx({ sizeBytes: 0 }))).rejects.toBeInstanceOf(NonRetryableError);
  });

  it('rejects an oversize file (non-retryable)', async () => {
    const step = new ValidationStep(configWithMax(100));
    await expect(step.execute(ctx({ sizeBytes: 200 }))).rejects.toBeInstanceOf(NonRetryableError);
  });

  it('treats maxBytes=0 as unlimited', async () => {
    const step = new ValidationStep(configWithMax(0));
    await expect(step.execute(ctx({ sizeBytes: 10_000_000 }))).resolves.toBeUndefined();
  });
});

describe('ContentTypeStep', () => {
  it('derives MIME type from the extension', async () => {
    const step = new ContentTypeStep();
    const c = ctx({ transfer: { filename: 'data.csv' } as FileTransfer });
    await step.execute(c);
    expect(c.metadata.contentType).toBe('text/csv');
  });

  it('falls back to octet-stream for unknown extensions', async () => {
    const step = new ContentTypeStep();
    const c = ctx({ transfer: { filename: 'weird.xyz' } as FileTransfer });
    await step.execute(c);
    expect(c.metadata.contentType).toBe('application/octet-stream');
  });
});
