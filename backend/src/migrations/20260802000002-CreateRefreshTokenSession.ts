import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRefreshTokenSession20260802000002 implements MigrationInterface {
  name = "CreateRefreshTokenSession20260802000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_token_session" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "member_id" uuid NOT NULL,
        "jti" uuid NOT NULL,
        "family_id" uuid NOT NULL,
        "token_hash" character(64) NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "revoked_at" timestamp with time zone,
        "replaced_by_jti" uuid,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_refresh_token_session" PRIMARY KEY ("id"),
        CONSTRAINT "uq_refresh_token_session_jti" UNIQUE ("jti"),
        CONSTRAINT "fk_refresh_token_session_member"
          FOREIGN KEY ("member_id") REFERENCES "member"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_refresh_token_session_member_id"
      ON "refresh_token_session" ("member_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_refresh_token_session_family_id"
      ON "refresh_token_session" ("family_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_refresh_token_session_expires_at"
      ON "refresh_token_session" ("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_token_session"`);
  }
}
