import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveFactCheckQueuedStatus20260730000002 implements MigrationInterface {
  name = "RemoveFactCheckQueuedStatus20260730000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "fact_check_batch_task_status_enum"
      RENAME TO "fact_check_batch_task_status_enum_old"
    `);
    await queryRunner.query(`
      CREATE TYPE "fact_check_batch_task_status_enum" AS ENUM (
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_batch_task"
      ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_batch_task"
      ALTER COLUMN "status"
      TYPE "fact_check_batch_task_status_enum"
      USING (
        CASE
          WHEN "status"::text = 'QUEUED' THEN 'PENDING'
          ELSE "status"::text
        END
      )::"fact_check_batch_task_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_batch_task"
      ALTER COLUMN "status" SET DEFAULT 'PENDING'
    `);
    await queryRunner.query(`
      DROP TYPE "fact_check_batch_task_status_enum_old"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "fact_check_batch_task_status_enum"
      RENAME TO "fact_check_batch_task_status_enum_without_queued"
    `);
    await queryRunner.query(`
      CREATE TYPE "fact_check_batch_task_status_enum" AS ENUM (
        'PENDING',
        'QUEUED',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_batch_task"
      ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_batch_task"
      ALTER COLUMN "status"
      TYPE "fact_check_batch_task_status_enum"
      USING "status"::text::"fact_check_batch_task_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "fact_check_batch_task"
      ALTER COLUMN "status" SET DEFAULT 'PENDING'
    `);
    await queryRunner.query(`
      DROP TYPE "fact_check_batch_task_status_enum_without_queued"
    `);
  }
}
