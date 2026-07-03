import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import type { AppConfig } from '../config/configuration';
import { S3_CLIENT } from './storage.constants';

export interface UploadResult {
  bucket: string;
  key: string;
  etag?: string;
}

export interface UploadParams {
  key: string;
  body: Readable;
  contentLength?: number;
  contentType?: string;
  /** Destination bucket; defaults to the configured bucket. */
  bucket?: string;
}

/**
 * Storage-agnostic facade over the standard AWS SDK v3 S3 mechanism. Callers
 * deal in keys + streams; the choice between a single PutObject and a managed
 * multipart upload lives here.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly partSizeBytes: number;
  private readonly concurrency: number;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    config: ConfigService<AppConfig, true>,
  ) {
    const s3Config = config.get('s3', { infer: true });
    this.bucket = s3Config.bucket;
    this.partSizeBytes = s3Config.uploadPartSizeBytes;
    this.concurrency = s3Config.uploadConcurrency;
  }

  /**
   * Persist an object using the standard S3 mechanism.
   *
   * - Known-size objects up to one part: a single `PutObjectCommand` — the
   *   canonical S3 write. Mid-stream network drops are handled by the caller's
   *   retry loop, which re-opens a fresh read stream on each attempt.
   * - Larger / unknown-size objects: a managed multipart `Upload` (also pure
   *   AWS SDK v3) so memory stays flat and each part retries independently.
   */
  async uploadStream(params: UploadParams): Promise<UploadResult> {
    const size = params.contentLength ?? 0;
    const bucket = params.bucket ?? this.bucket;
    if (bucket !== this.bucket) await this.ensureBucket(bucket);

    if (size > 0 && size <= this.partSizeBytes) {
      const res = await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: params.key,
          Body: params.body,
          ContentLength: size,
          ContentType: params.contentType,
        }),
      );
      this.logger.debug(`PutObject ${bucket}/${params.key} (${size} bytes)`);
      return { bucket, key: params.key, etag: this.normalizeEtag(res.ETag) };
    }

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      },
      queueSize: this.concurrency,
      partSize: this.partSizeBytes,
      leavePartsOnError: false, // abort + clean up orphaned parts on failure
    });

    upload.on('httpUploadProgress', (p) => {
      if (p.loaded && p.total) {
        this.logger.debug(`Multipart ${params.key}: ${p.loaded}/${p.total} bytes`);
      }
    });

    const result = await upload.done();
    return {
      bucket,
      key: params.key,
      etag: 'ETag' in result ? this.normalizeEtag(result.ETag) : undefined,
    };
  }

  /** Create the bucket if it doesn't exist (supports routing to new buckets). */
  private async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err) {
      if (this.isNotFound(err)) {
        await this.s3.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Created destination bucket "${bucket}"`);
      } else {
        throw err;
      }
    }
  }

  /** True when an object already exists — lets the worker skip redundant work. */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (this.isNotFound(err)) return false;
      throw err;
    }
  }

  /** Liveness probe used by the health module. */
  async checkBucket(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  private normalizeEtag(etag?: string): string | undefined {
    return etag?.replaceAll('"', '');
  }

  private isNotFound(err: unknown): boolean {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
  }
}
