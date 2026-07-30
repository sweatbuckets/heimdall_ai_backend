import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameFinalFactCheckingToDebateFinalized20260730000001 implements MigrationInterface {
  name = "RenameFinalFactCheckingToDebateFinalized20260730000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "debate_status_enum"
      RENAME VALUE 'FINAL_FACT_CHECKING' TO 'DEBATE_FINALIZED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "debate_status_enum"
      RENAME VALUE 'DEBATE_FINALIZED' TO 'FINAL_FACT_CHECKING'
    `);
  }
}
