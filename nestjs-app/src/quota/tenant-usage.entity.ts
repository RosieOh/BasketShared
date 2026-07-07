import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Per-tenant storage usage aggregate, updated on each successful transfer. */
@Entity({ name: 'tenant_usage' })
export class TenantUsage {
  @PrimaryColumn({ name: 'tenant_id', type: 'varchar', length: 100 })
  tenantId!: string;

  @Column({ name: 'object_count', type: 'bigint', default: 0 })
  objectCount!: string;

  @Column({ name: 'bytes_stored', type: 'bigint', default: 0 })
  bytesStored!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
