import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDebateTurnAnalysisProcessingStartedAt20260721000000 implements MigrationInterface {
  name = "AddDebateTurnAnalysisProcessingStartedAt20260721000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debate_turn"
      ADD COLUMN "analysis_processing_started_at" timestamp with time zone
    `);
    await queryRunner.query(`
      UPDATE "debate_turn"
      SET "analysis_processing_started_at" = NOW()
      WHERE "analysis_status" = 'PROCESSING'
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_turn_analysis_recovery"
      ON "debate_turn" (
        "analysis_status",
        "analysis_processing_started_at"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_debate_turn_analysis_recovery"`);
    await queryRunner.query(`
      ALTER TABLE "debate_turn"
      DROP COLUMN "analysis_processing_started_at"
    `);
  }
}
