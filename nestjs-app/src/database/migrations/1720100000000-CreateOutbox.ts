import { MigrationInterface, QueryRunner } from 'typeorm';

/** Transactional outbox table + status index. */
export class CreateOutbox1720100000000 implements MigrationInterface {
  name = 'CreateOutbox1720100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "outbox_events_status_enum" AS ENUM ('PENDING', 'PUBLISHED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id"           uuid NOT NULL DEFAULT uuid_generate_v4(),
        "aggregate_id" uuid NOT NULL,
        "type"         varchar(100) NOT NULL,
        "payload"      jsonb NOT NULL,
        "status"       "outbox_events_status_enum" NOT NULL DEFAULT 'PENDING',
        "attempts"     integer NOT NULL DEFAULT 0,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz,
        CONSTRAINT "pk_outbox_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_outbox_status" ON "outbox_events" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_events"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "outbox_events_status_enum"`);
  }
}
