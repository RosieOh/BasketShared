import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-tenancy: tenant_id columns + PostgreSQL Row-Level Security on
 * file_transfers. The policy isolates rows by `app.current_tenant`; when that
 * GUC is unset (system/worker context or platform admin) it allows everything.
 * FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner.
 */
export class AddTenancyRls1720300000000 implements MigrationInterface {
  name = 'AddTenancyRls1720300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" varchar(100) NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_transfers" ADD COLUMN IF NOT EXISTS "tenant_id" varchar(100) NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_file_transfers_tenant" ON "file_transfers" ("tenant_id")`,
    );

    await queryRunner.query(`ALTER TABLE "file_transfers" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "file_transfers" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "file_transfers"
      USING (
        current_setting('app.current_tenant', true) IS NULL
        OR current_setting('app.current_tenant', true) = ''
        OR tenant_id = current_setting('app.current_tenant', true)
      )
      WITH CHECK (
        current_setting('app.current_tenant', true) IS NULL
        OR current_setting('app.current_tenant', true) = ''
        OR tenant_id = current_setting('app.current_tenant', true)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation" ON "file_transfers"`);
    await queryRunner.query(`ALTER TABLE "file_transfers" NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "file_transfers" DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_file_transfers_tenant"`);
    await queryRunner.query(`ALTER TABLE "file_transfers" DROP COLUMN IF EXISTS "tenant_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "tenant_id"`);
  }
}
