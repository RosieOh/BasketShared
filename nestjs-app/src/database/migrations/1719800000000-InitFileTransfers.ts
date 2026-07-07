import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema: the `file_transfers` audit table plus its status enum and the
 * unique idempotency index that guards against duplicate webhook deliveries.
 */
export class InitFileTransfers1719800000000 implements MigrationInterface {
  name = 'InitFileTransfers1719800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid-ossp is created by the DB init script (needs superuser); see
    // postgres-init/10-app-role.sh. The app role runs migrations as a non-superuser.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "file_transfers_status_enum" AS ENUM
          ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE "file_transfers" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "idempotency_key" varchar(128) NOT NULL,
        "filename"        varchar(1024) NOT NULL,
        "virtual_path"    varchar(2048) NOT NULL,
        "source_path"     varchar(2048) NOT NULL,
        "object_key"      varchar(2048),
        "bucket"          varchar(255) NOT NULL,
        "size_bytes"      bigint NOT NULL,
        "etag"            varchar(255),
        "status"          "file_transfers_status_enum" NOT NULL DEFAULT 'PENDING',
        "attempts"        integer NOT NULL DEFAULT 0,
        "error_log"       text,
        "username"        varchar(255) NOT NULL,
        "protocol"        varchar(32),
        "session_id"      varchar(255),
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "updated_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_file_transfers" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_file_transfers_idempotency_key"
        ON "file_transfers" ("idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_file_transfers_status"
        ON "file_transfers" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_file_transfers_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_file_transfers_idempotency_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "file_transfers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "file_transfers_status_enum"`);
  }
}
