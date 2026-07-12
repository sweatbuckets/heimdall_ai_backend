import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMemberTable20260711000002 implements MigrationInterface {
  name = "CreateMemberTable20260711000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "member" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "display_name" character varying(100) NOT NULL,
        "profile_image_url" character varying(1000),
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_member" PRIMARY KEY ("id"),
        CONSTRAINT "chk_member_display_name_not_blank"
          CHECK (length(trim("display_name")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_member_created_at"
      ON "member" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "idx_member_created_at"
    `);
    await queryRunner.query(`
      DROP TABLE "member"
    `);
  }
}
