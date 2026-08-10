import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCommunityChat20260802000003 implements MigrationInterface {
  name = "CreateCommunityChat20260802000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "community" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "host_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "topic" text NOT NULL,
        "category" varchar(30) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'WAITING',
        "rounds" smallint NOT NULL,
        "is_public" boolean NOT NULL DEFAULT true,
        "host_claim" text NOT NULL DEFAULT '',
        "host_reasons" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_community" PRIMARY KEY ("id"),
        CONSTRAINT "ck_community_rounds" CHECK ("rounds" BETWEEN 1 AND 9),
        CONSTRAINT "ck_community_status"
          CHECK ("status" IN ('WAITING', 'ACTIVE', 'CLOSED')),
        CONSTRAINT "fk_community_host"
          FOREIGN KEY ("host_id") REFERENCES "member"("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_community_created_at"
      ON "community" ("created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE "community_member" (
        "community_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "role" varchar(20) NOT NULL,
        "joined_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_community_member"
          PRIMARY KEY ("community_id", "member_id"),
        CONSTRAINT "ck_community_member_role"
          CHECK ("role" IN ('HOST', 'MEMBER')),
        CONSTRAINT "fk_community_member_community"
          FOREIGN KEY ("community_id") REFERENCES "community"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_community_member_member"
          FOREIGN KEY ("member_id") REFERENCES "member"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_community_member_member_id"
      ON "community_member" ("member_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "community_message" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "community_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "client_message_id" varchar(100) NOT NULL,
        "body" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_community_message" PRIMARY KEY ("id"),
        CONSTRAINT "uq_community_message_client"
          UNIQUE ("community_id", "author_id", "client_message_id"),
        CONSTRAINT "ck_community_message_body"
          CHECK (char_length("body") BETWEEN 1 AND 2000),
        CONSTRAINT "fk_community_message_community"
          FOREIGN KEY ("community_id") REFERENCES "community"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_community_message_author"
          FOREIGN KEY ("author_id") REFERENCES "member"("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_community_message_timeline"
      ON "community_message" ("community_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_community_message_author_id"
      ON "community_message" ("author_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "community_message"`);
    await queryRunner.query(`DROP TABLE "community_member"`);
    await queryRunner.query(`DROP TABLE "community"`);
  }
}
