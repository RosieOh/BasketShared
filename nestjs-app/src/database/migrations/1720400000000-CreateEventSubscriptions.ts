import { MigrationInterface, QueryRunner } from 'typeorm';

/** Outbound webhook subscriptions per tenant. */
export class CreateEventSubscriptions1720400000000 implements MigrationInterface {
  name = 'CreateEventSubscriptions1720400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "event_subscriptions" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id"  varchar(100) NOT NULL,
        "url"        varchar(2048) NOT NULL,
        "events"     text NOT NULL,
        "secret"     varchar(255) NOT NULL,
        "active"     boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_event_subscriptions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_event_subs_tenant" ON "event_subscriptions" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_event_subs_tenant"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_subscriptions"`);
  }
}
