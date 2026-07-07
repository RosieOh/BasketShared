import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OutboxStatus {
  PENDING = 'PENDING',
  PUBLISHED = 'PUBLISHED',
}

/**
 * Transactional outbox record. Written in the SAME DB transaction as the domain
 * change (the FileTransfer row), then published to the queue by the relay. This
 * removes the dual-write hazard: either both the row and the intent-to-enqueue
 * commit, or neither does.
 */
@Entity({ name: 'outbox_events' })
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The aggregate this event concerns (the transfer id). */
  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ name: 'type', type: 'varchar', length: 100 })
  type!: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Index('idx_outbox_status')
  @Column({ name: 'status', type: 'enum', enum: OutboxStatus, default: OutboxStatus.PENDING })
  status!: OutboxStatus;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
