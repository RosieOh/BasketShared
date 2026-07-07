import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds envelope-encryption columns to file_transfers. */
export class AddEncryption1720200000000 implements MigrationInterface {
  name = 'AddEncryption1720200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_transfers" ADD COLUMN IF NOT EXISTS "encrypted" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_transfers" ADD COLUMN IF NOT EXISTS "wrapped_dek" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "file_transfers" DROP COLUMN IF EXISTS "wrapped_dek"`);
    await queryRunner.query(`ALTER TABLE "file_transfers" DROP COLUMN IF EXISTS "encrypted"`);
  }
}
