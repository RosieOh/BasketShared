import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-tenant usage aggregates for quota enforcement + metering. */
export class CreateTenantUsage1720500000000 implements MigrationInterface {
  name = 'CreateTenantUsage1720500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenant_usage" (
        "tenant_id"    varchar(100) NOT NULL,
        "object_count" bigint NOT NULL DEFAULT 0,
        "bytes_stored" bigint NOT NULL DEFAULT 0,
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tenant_usage" PRIMARY KEY ("tenant_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_usage"`);
  }
}
