import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDebateTurnAnalysisStatus20260711000001 implements MigrationInterface {
  name = "AddDebateTurnAnalysisStatus20260711000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "debate_turn_analysis_status_enum" AS ENUM (
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "debate_turn"
      ADD COLUMN "analysis_status" "debate_turn_analysis_status_enum"
      NOT NULL DEFAULT 'PENDING'
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_turn_analysis_status"
      ON "debate_turn" ("analysis_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "idx_debate_turn_analysis_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "debate_turn"
      DROP COLUMN "analysis_status"
    `);
    await queryRunner.query(`
      DROP TYPE "debate_turn_analysis_status_enum"
    `);
  }
}
