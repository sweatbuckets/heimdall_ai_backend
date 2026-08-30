import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDebateTimeoutIndex20260810000004 implements MigrationInterface {
  name = "AddDebateTimeoutIndex20260810000004";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_debate_timeout_recovery" ON "debate" ("status", "started_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_debate_timeout_recovery"`,
    );
  }
}
