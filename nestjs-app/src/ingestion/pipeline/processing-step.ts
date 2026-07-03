import { FileTransfer } from '../entities/file-transfer.entity';

/**
 * Mutable state threaded through the processing steps. Steps may read the file,
 * enrich `metadata`, or throw to abort (NonRetryableError => permanent failure).
 */
export interface ProcessingContext {
  transfer: FileTransfer;
  /** Absolute path of the file to upload (a transform step may repoint this). */
  sourcePath: string;
  sizeBytes: number;
  /** Enrichment bag; e.g. `contentType` is consumed by the upload. */
  metadata: {
    contentType?: string;
    [key: string]: unknown;
  };
}

/**
 * One pluggable stage in the ingest pipeline. Ordered stages run before the S3
 * upload, enabling validation, AV scanning, and enrichment to be added without
 * touching the worker — the whole point of the loosely-coupled design.
 */
export interface ProcessingStep {
  readonly name: string;
  execute(ctx: ProcessingContext): Promise<void>;
}

/** DI token for the ordered list of processing steps. */
export const PROCESSING_STEPS = Symbol('PROCESSING_STEPS');
