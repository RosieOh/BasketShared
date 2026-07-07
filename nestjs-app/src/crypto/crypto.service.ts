import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, type DecipherGCM, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import type { AppConfig } from '../config/configuration';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Client-side envelope encryption.
 *
 * Each object gets a fresh random Data Encryption Key (DEK). The file is
 * encrypted with AES-256-GCM under the DEK; the DEK itself is wrapped with the
 * master key (KEK) and stored (base64) alongside the transfer row. The uploaded
 * object layout is: [IV(12) || ciphertext || authTag(16)] — self-describing, so
 * only the wrapped DEK needs to be persisted. Mirrors how S3 SSE-KMS /
 * client-side encryption work, without a external KMS dependency.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly enabled: boolean;
  private readonly kek?: Buffer;
  /** Fixed GCM overhead added to the plaintext length (IV + tag). */
  readonly overheadBytes = IV_LEN + TAG_LEN;

  constructor(config: ConfigService<AppConfig, true>) {
    const enc = config.get('encryption', { infer: true });
    this.enabled = enc.enabled;
    // Load the KEK whenever it's provided — decryption of previously-encrypted
    // objects must work even when new-upload encryption is turned off.
    if (enc.kek) {
      this.kek = Buffer.from(enc.kek, 'base64');
      if (this.kek.length !== 32) throw new Error('ENCRYPTION_KEK must decode to 32 bytes (base64)');
    }
    if (this.enabled) {
      if (!this.kek) throw new Error('ENCRYPTION_ENABLED but ENCRYPTION_KEK is not set');
      this.logger.log('Object encryption enabled (AES-256-GCM envelope)');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Build a Transform that emits [IV || ciphertext || authTag], plus the wrapped
   * DEK to persist. Pipe a plaintext read stream through `stream` to encrypt.
   */
  createEncryptStream(): { stream: Transform; wrappedDek: string } {
    const dek = randomBytes(32);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, dek, iv);
    let ivEmitted = false;
    const stream = new Transform({
      transform(chunk, _enc, cb) {
        if (!ivEmitted) {
          this.push(iv);
          ivEmitted = true;
        }
        cb(null, cipher.update(chunk));
      },
      flush(cb) {
        if (!ivEmitted) {
          this.push(iv);
          ivEmitted = true;
        }
        const final = cipher.final();
        cb(null, Buffer.concat([final, cipher.getAuthTag()]));
      },
    });
    return { stream, wrappedDek: this.wrapDek(dek) };
  }

  /**
   * Streaming decrypt Transform for `[IV || ciphertext || authTag]`. Withholds
   * the trailing 16-byte GCM tag until the stream ends, so arbitrarily large
   * objects decrypt with constant memory. Throws on tag mismatch (tamper).
   */
  createDecryptStream(wrappedDek: string): Transform {
    const dek = this.unwrapDek(wrappedDek);
    let decipher: DecipherGCM | null = null;
    let buffered = Buffer.alloc(0);
    return new Transform({
      transform(chunk: Buffer, _enc, cb) {
        buffered = Buffer.concat([buffered, chunk]);
        if (!decipher) {
          if (buffered.length < IV_LEN) return cb();
          decipher = createDecipheriv(ALGO, dek, buffered.subarray(0, IV_LEN));
          buffered = buffered.subarray(IV_LEN);
        }
        // Keep the last TAG_LEN bytes withheld (they may be the auth tag).
        if (buffered.length > TAG_LEN) {
          const feed = buffered.subarray(0, buffered.length - TAG_LEN);
          buffered = buffered.subarray(buffered.length - TAG_LEN);
          return cb(null, decipher.update(feed));
        }
        cb();
      },
      flush(cb) {
        try {
          if (!decipher) return cb(new Error('ciphertext too short'));
          decipher.setAuthTag(buffered); // the withheld trailing bytes = tag
          cb(null, decipher.final());
        } catch (err) {
          cb(err as Error);
        }
      },
    });
  }

  /** Decrypt a full encrypted buffer (used for verification / round-trip). */
  decrypt(encrypted: Buffer, wrappedDek: string): Buffer {
    const dek = this.unwrapDek(wrappedDek);
    const iv = encrypted.subarray(0, IV_LEN);
    const tag = encrypted.subarray(encrypted.length - TAG_LEN);
    const ciphertext = encrypted.subarray(IV_LEN, encrypted.length - TAG_LEN);
    const decipher = createDecipheriv(ALGO, dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private wrapDek(dek: Buffer): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.kek!, iv);
    const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString('base64');
  }

  private unwrapDek(wrapped: string): Buffer {
    const buf = Buffer.from(wrapped, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const enc = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher = createDecipheriv(ALGO, this.kek!, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  }
}
