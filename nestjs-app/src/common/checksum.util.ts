import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

export interface FileChecksums {
  /** Hex MD5 — comparable to a single-part S3 ETag for transport verification. */
  md5: string;
  /** Hex SHA-256 — the canonical integrity record stored for auditing. */
  sha256: string;
}

/**
 * Compute MD5 and SHA-256 of a file in one streaming pass (constant memory,
 * safe for very large files).
 */
export async function computeFileChecksums(path: string): Promise<FileChecksums> {
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');

  const sink = new Writable({
    write(chunk, _enc, cb) {
      md5.update(chunk);
      sha256.update(chunk);
      cb();
    },
  });

  await pipeline(createReadStream(path), sink);

  return { md5: md5.digest('hex'), sha256: sha256.digest('hex') };
}
