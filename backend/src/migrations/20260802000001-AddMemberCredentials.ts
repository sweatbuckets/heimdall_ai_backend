import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMemberCredentials20260802000001 implements MigrationInterface {
  name = "AddMemberCredentials20260802000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "member"
      ADD COLUMN "email" character varying(320),
      ADD COLUMN "password_hash" character varying(100),
      ADD COLUMN "gender" character varying(20),
      ADD COLUMN "age" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "member"
      ADD CONSTRAINT "uq_member_email" UNIQUE ("email"),
      ADD CONSTRAINT "chk_member_age_range"
        CHECK ("age" IS NULL OR ("age" >= 0 AND "age" <= 150)),
      ADD CONSTRAINT "chk_member_credentials_pair"
        CHECK (
          ("email" IS NULL AND "password_hash" IS NULL)
          OR ("email" IS NOT NULL AND "password_hash" IS NOT NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "member"
      DROP CONSTRAINT "chk_member_credentials_pair",
      DROP CONSTRAINT "chk_member_age_range",
      DROP CONSTRAINT "uq_member_email"
    `);
    await queryRunner.query(`
      ALTER TABLE "member"
      DROP COLUMN "age",
      DROP COLUMN "gender",
      DROP COLUMN "password_hash",
      DROP COLUMN "email"
    `);
  }
}
