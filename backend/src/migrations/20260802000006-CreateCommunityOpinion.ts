import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCommunityOpinion20260802000006 implements MigrationInterface {
  name = "CreateCommunityOpinion20260802000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "community_opinion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "community_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "claim" text NOT NULL,
        "reasons" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_community_opinion" PRIMARY KEY ("id"),
        CONSTRAINT "uq_community_opinion_author"
          UNIQUE ("community_id", "author_id"),
        CONSTRAINT "ck_community_opinion_claim"
          CHECK (char_length(trim("claim")) BETWEEN 1 AND 2000),
        CONSTRAINT "fk_community_opinion_community"
          FOREIGN KEY ("community_id") REFERENCES "community"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_community_opinion_author"
          FOREIGN KEY ("author_id") REFERENCES "member"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_community_opinion_timeline"
      ON "community_opinion" ("community_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "community_opinion"`);
  }
}
