import { MigrationInterface, QueryRunner } from "typeorm";

export class RefineVerificationStatus20260829000000 implements MigrationInterface {
  name = "RefineVerificationStatus20260829000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "verification_status_enum"
      RENAME TO "verification_status_enum_old"
    `);
    await queryRunner.query(`
      CREATE TYPE "verification_status_enum" AS ENUM (
        'SUPPORTED',
        'CONTRADICTED',
        'PARTIALLY_SUPPORTED',
        'INSUFFICIENT_EVIDENCE',
        'NOT_VERIFIABLE',
        'OUTDATED'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_result"
      ALTER COLUMN "status" TYPE "verification_status_enum"
      USING (
        CASE "status"::text
          WHEN 'OUTDATED_OR_TIME_SENSITIVE' THEN 'OUTDATED'
          ELSE "status"::text
        END
      )::"verification_status_enum"
    `);
    await queryRunner.query(`DROP TYPE "verification_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "verification_status_enum"
      RENAME TO "verification_status_enum_new"
    `);
    await queryRunner.query(`
      CREATE TYPE "verification_status_enum" AS ENUM (
        'SUPPORTED',
        'CONTRADICTED',
        'PARTIALLY_SUPPORTED',
        'INSUFFICIENT_EVIDENCE',
        'NOT_VERIFIABLE',
        'OUTDATED_OR_TIME_SENSITIVE'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_result"
      ALTER COLUMN "status" TYPE "verification_status_enum"
      USING (
        CASE "status"::text
          WHEN 'OUTDATED' THEN 'OUTDATED_OR_TIME_SENSITIVE'
          ELSE "status"::text
        END
      )::"verification_status_enum"
    `);
    await queryRunner.query(`DROP TYPE "verification_status_enum_new"`);
  }
}
