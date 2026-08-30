import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCommunityDebateTimeoutNotification20260824000000 implements MigrationInterface {
  name = "AddCommunityDebateTimeoutNotification20260824000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_message"
      DROP CONSTRAINT "ck_community_message_type",
      ADD CONSTRAINT "ck_community_message_type"
      CHECK ("message_type" IN (
        'TEXT',
        'DEBATE_RESULT',
        'DEBATE_FORFEIT',
        'DEBATE_TIMEOUT'
      ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "community_message"
      WHERE "message_type" = 'DEBATE_TIMEOUT'
    `);
    await queryRunner.query(`
      ALTER TABLE "community_message"
      DROP CONSTRAINT "ck_community_message_type",
      ADD CONSTRAINT "ck_community_message_type"
      CHECK ("message_type" IN ('TEXT', 'DEBATE_RESULT', 'DEBATE_FORFEIT'))
    `);
  }
}
