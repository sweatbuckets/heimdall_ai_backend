import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDebateJudgingStartedAt20260730000000 implements MigrationInterface {
  name = "AddDebateJudgingStartedAt20260730000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debate"
      ADD COLUMN "judging_started_at" timestamp with time zone
    `);
    await queryRunner.query(`
      UPDATE "debate"
      SET "judging_started_at" = NOW()
      WHERE "status" = 'JUDGING'
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_judging_recovery"
      ON "debate" ("status", "judging_started_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_debate_judging_recovery"`);
    await queryRunner.query(`
      ALTER TABLE "debate"
      DROP COLUMN "judging_started_at"
    `);
  }
}
