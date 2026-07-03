import { Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import { ProcessingContext, ProcessingStep } from './processing-step';

/** Extension → MIME map for the common ingest formats. */
const MIME_BY_EXT: Record<string, string> = {
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Enrichment step: derives the object Content-Type from the file extension so
 * the S3 object is stored with a meaningful type instead of a generic blob.
 */
@Injectable()
export class ContentTypeStep implements ProcessingStep {
  readonly name = 'content-type';

  async execute(ctx: ProcessingContext): Promise<void> {
    const ext = extname(ctx.transfer.filename).toLowerCase();
    ctx.metadata.contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  }
}
