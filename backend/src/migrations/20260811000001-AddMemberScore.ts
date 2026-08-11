import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMemberScore20260811000001 implements MigrationInterface {
  name = "AddMemberScore20260811000001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "member"
      ADD COLUMN "score" integer NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "member" DROP COLUMN "score"`);
  }
}
