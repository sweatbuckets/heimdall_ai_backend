import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCommunityMemberDebateIntent20260810000000 implements MigrationInterface {
  name = "AddCommunityMemberDebateIntent20260810000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_member"
      ADD COLUMN "debate_intent" varchar(30) NOT NULL DEFAULT 'OPEN_TO_DEBATE'
    `);
    await queryRunner.query(`
      ALTER TABLE "community_member"
      ADD CONSTRAINT "ck_community_member_debate_intent"
      CHECK ("debate_intent" IN ('OPEN_TO_DEBATE', 'PREPARING'))
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_community_member_debate_intent"
      ON "community_member" ("community_id", "debate_intent", "joined_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_community_member_debate_intent"`);
    await queryRunner.query(`
      ALTER TABLE "community_member"
      DROP CONSTRAINT "ck_community_member_debate_intent"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_member"
      DROP COLUMN "debate_intent"
    `);
  }
}
