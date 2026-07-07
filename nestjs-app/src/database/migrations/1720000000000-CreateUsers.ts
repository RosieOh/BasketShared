import { MigrationInterface, QueryRunner } from 'typeorm';

/** Users table for JWT + RBAC auth. */
export class CreateUsers1720000000000 implements MigrationInterface {
  name = 'CreateUsers1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
        "username"      varchar(255) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "roles"         text NOT NULL,
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_username" ON "users" ("username")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_username"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
