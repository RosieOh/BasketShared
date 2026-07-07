import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A tenant's registration to receive signed outbound webhooks for events. */
@Entity({ name: 'event_subscriptions' })
export class EventSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_event_subs_tenant')
  @Column({ name: 'tenant_id', type: 'varchar', length: 100 })
  tenantId!: string;

  @Column({ name: 'url', type: 'varchar', length: 2048 })
  url!: string;

  /** Event types this subscription wants, e.g. transfer.completed, transfer.failed. */
  @Column({ name: 'events', type: 'simple-array' })
  events!: string[];

  /** Per-subscription HMAC secret used to sign delivery payloads. */
  @Column({ name: 'secret', type: 'varchar', length: 255 })
  secret!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
