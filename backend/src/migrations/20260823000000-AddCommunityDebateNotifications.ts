import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCommunityDebateNotifications20260823000000 implements MigrationInterface {
  name = "AddCommunityDebateNotifications20260823000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_message"
      ALTER COLUMN "author_id" DROP NOT NULL,
      ADD COLUMN "message_type" varchar(30) NOT NULL DEFAULT 'TEXT',
      ADD COLUMN "debate_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "community_message"
      ADD CONSTRAINT "ck_community_message_type"
      CHECK ("message_type" IN ('TEXT', 'DEBATE_RESULT', 'DEBATE_FORFEIT')),
      ADD CONSTRAINT "fk_community_message_debate"
      FOREIGN KEY ("debate_id") REFERENCES "debate"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_community_message_debate_event"
      ON "community_message" ("debate_id", "message_type")
      WHERE "debate_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_community_message_debate_event"`);
    await queryRunner.query(`
      ALTER TABLE "community_message"
      DROP CONSTRAINT "fk_community_message_debate",
      DROP CONSTRAINT "ck_community_message_type",
      DROP COLUMN "debate_id",
      DROP COLUMN "message_type"
    `);
    await queryRunner.query(`
      DELETE FROM "community_message" WHERE "author_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_message" ALTER COLUMN "author_id" SET NOT NULL
    `);
  }
}
