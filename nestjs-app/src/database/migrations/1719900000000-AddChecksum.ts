import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the SHA-256 integrity column to file_transfers. */
export class AddChecksum1719900000000 implements MigrationInterface {
  name = 'AddChecksum1719900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_transfers" ADD COLUMN IF NOT EXISTS "checksum_sha256" varchar(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_transfers" DROP COLUMN IF EXISTS "checksum_sha256"`,
    );
  }
}
