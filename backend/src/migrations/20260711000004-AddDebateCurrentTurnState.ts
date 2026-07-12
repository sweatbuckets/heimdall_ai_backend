import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDebateCurrentTurnState20260711000004 implements MigrationInterface {
  name = "AddDebateCurrentTurnState20260711000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debate"
        ADD COLUMN "current_phase" "debate_phase_enum",
        ADD COLUMN "current_round" integer,
        ADD COLUMN "current_turn_side" "debate_side_enum",
        ADD COLUMN "current_turn_started_at" timestamp with time zone
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
        ADD CONSTRAINT "chk_debate_current_round_positive"
        CHECK ("current_round" IS NULL OR "current_round" >= 1)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_current_turn"
      ON "debate" (
        "status",
        "current_phase",
        "current_round",
        "current_turn_side"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_debate_current_turn"`);
    await queryRunner.query(`
      ALTER TABLE "debate"
        DROP CONSTRAINT "chk_debate_current_round_positive"
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
        DROP COLUMN "current_turn_started_at",
        DROP COLUMN "current_turn_side",
        DROP COLUMN "current_round",
        DROP COLUMN "current_phase"
    `);
  }
}
