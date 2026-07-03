import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Lifecycle of a single file transfer.
 *   PENDING    -> accepted from webhook, queued for processing
 *   PROCESSING -> actively streaming SFTPGo -> S3
 *   SUCCESS    -> object persisted in the bucket
 *   FAILED     -> exhausted all retry attempts
 */
export enum TransferStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity({ name: 'file_transfers' })
export class FileTransfer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Deterministic hash of the upload event. A UNIQUE constraint on this column
   * is what makes webhook delivery idempotent: a duplicate POST collides here
   * and is rejected before any work is scheduled.
   */
  @Index('uq_file_transfers_idempotency_key', { unique: true })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'filename', type: 'varchar', length: 1024 })
  filename!: string;

  /** User-relative path reported by SFTPGo (e.g. "/inbox/report.csv"). */
  @Column({ name: 'virtual_path', type: 'varchar', length: 2048 })
  virtualPath!: string;

  /** Absolute source path on the shared volume the orchestrator reads from. */
  @Column({ name: 'source_path', type: 'varchar', length: 2048 })
  sourcePath!: string;

  /** Destination object key within the bucket. */
  @Column({ name: 'object_key', type: 'varchar', length: 2048, nullable: true })
  objectKey!: string | null;

  @Column({ name: 'bucket', type: 'varchar', length: 255 })
  bucket!: string;

  /** Size in bytes. bigint is returned as string by pg; we store the raw value. */
  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  /** S3 ETag returned on successful upload — useful for integrity auditing. */
  @Column({ name: 'etag', type: 'varchar', length: 255, nullable: true })
  etag!: string | null;

  /** Canonical SHA-256 of the source, computed before upload (hex). */
  @Column({ name: 'checksum_sha256', type: 'varchar', length: 64, nullable: true })
  checksumSha256!: string | null;

  @Index('idx_file_transfers_status')
  @Column({ name: 'status', type: 'enum', enum: TransferStatus, default: TransferStatus.PENDING })
  status!: TransferStatus;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'error_log', type: 'text', nullable: true })
  errorLog!: string | null;

  // ---- Audit metadata copied from the originating event ----
  @Column({ name: 'username', type: 'varchar', length: 255 })
  username!: string;

  @Column({ name: 'protocol', type: 'varchar', length: 32, nullable: true })
  protocol!: string | null;

  @Column({ name: 'session_id', type: 'varchar', length: 255, nullable: true })
  sessionId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
