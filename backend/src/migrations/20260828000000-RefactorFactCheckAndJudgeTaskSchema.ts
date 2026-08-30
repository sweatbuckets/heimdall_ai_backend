import { MigrationInterface, QueryRunner } from "typeorm";

export class RefactorFactCheckAndJudgeTaskSchema20260828000000 implements MigrationInterface {
  name = "RefactorFactCheckAndJudgeTaskSchema20260828000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Incomplete AI pipeline data is intentionally reset instead of backfilled.
    await queryRunner.query(`
      DELETE FROM "argument_component" "component"
      USING "debate_turn" "turn", "debate" "debate"
      WHERE "component"."turn_id" = "turn"."id"
        AND "turn"."debate_id" = "debate"."id"
        AND "debate"."status" IN (
          'IN_PROGRESS',
          'DEBATE_FINALIZED',
          'JUDGING'
        )
    `);
    await queryRunner.query(`
      UPDATE "debate_turn" "turn"
      SET
        "analysis_status" = 'PENDING',
        "analysis_processing_started_at" = NULL
      FROM "debate" "debate"
      WHERE "turn"."debate_id" = "debate"."id"
        AND "debate"."status" IN (
          'IN_PROGRESS',
          'DEBATE_FINALIZED',
          'JUDGING'
        )
    `);
    await queryRunner.query(`
      UPDATE "debate"
      SET
        "status" = 'DEBATE_FINALIZED',
        "judging_started_at" = NULL
      WHERE "status" = 'JUDGING'
        AND NOT EXISTS (
          SELECT 1
          FROM "judgment_result"
          WHERE "judgment_result"."debate_id" = "debate"."id"
        )
    `);

    // Old task-scoped fact-check data is intentionally discarded.
    await queryRunner.query(`DROP TABLE "fact_check_source"`);
    await queryRunner.query(`DROP TABLE "fact_check_result"`);
    await queryRunner.query(`DROP TABLE "fact_check_batch_target"`);
    await queryRunner.query(`DROP TABLE "fact_check_batch_task"`);
    await queryRunner.query(`DROP TYPE "fact_check_batch_task_status_enum"`);

    await queryRunner.query(`
      CREATE TYPE "fact_check_batch_status_enum" AS ENUM (
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "fact_check_stage_enum" AS ENUM (
        'GROUNDING',
        'SYNTHESIS'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "fact_check_stage_task_status_enum" AS ENUM (
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "judge_task_status_enum" AS ENUM (
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "fact_check_batch" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "debate_id" uuid NOT NULL,
        "phase" "debate_phase_enum" NOT NULL,
        "round" integer NOT NULL,
        "status" "fact_check_batch_status_enum" NOT NULL DEFAULT 'PENDING',
        "failure_reason" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "completed_at" timestamp with time zone,
        CONSTRAINT "pk_fact_check_batch" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_batch_debate_phase_round"
          UNIQUE ("debate_id", "phase", "round"),
        CONSTRAINT "fk_fact_check_batch_debate"
          FOREIGN KEY ("debate_id") REFERENCES "debate"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_fact_check_batch_round_positive"
          CHECK ("round" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_batch_status"
      ON "fact_check_batch" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_batch_debate_id"
      ON "fact_check_batch" ("debate_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "fact_check_batch_target" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_batch_id" uuid NOT NULL,
        "component_id" uuid NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fact_check_batch_target" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_batch_target_batch_component"
          UNIQUE ("fact_check_batch_id", "component_id"),
        CONSTRAINT "fk_fact_check_batch_target_batch"
          FOREIGN KEY ("fact_check_batch_id")
          REFERENCES "fact_check_batch"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fact_check_batch_target_component"
          FOREIGN KEY ("component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_batch_target_component_id"
      ON "fact_check_batch_target" ("component_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "fact_check_stage_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_batch_id" uuid NOT NULL,
        "stage" "fact_check_stage_enum" NOT NULL,
        "status" "fact_check_stage_task_status_enum" NOT NULL
          DEFAULT 'PENDING',
        "bull_mq_job_id" character varying(255),
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error_code" character varying(100),
        "failure_reason" text,
        "processing_started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fact_check_stage_task" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_stage_task_batch_stage"
          UNIQUE ("fact_check_batch_id", "stage"),
        CONSTRAINT "fk_fact_check_stage_task_batch"
          FOREIGN KEY ("fact_check_batch_id")
          REFERENCES "fact_check_batch"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fact_check_stage_task_attempt_count_nonnegative"
          CHECK ("attempt_count" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_stage_task_status"
      ON "fact_check_stage_task" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_stage_task_recovery"
      ON "fact_check_stage_task" ("status", "processing_started_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "fact_check_grounding_snapshot" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_batch_id" uuid NOT NULL,
        "evidence_text" text NOT NULL,
        "web_search_queries" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "sources" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fact_check_grounding_snapshot" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_grounding_snapshot_batch_id"
          UNIQUE ("fact_check_batch_id"),
        CONSTRAINT "fk_fact_check_grounding_snapshot_batch"
          FOREIGN KEY ("fact_check_batch_id")
          REFERENCES "fact_check_batch"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fact_check_grounding_snapshot_queries_array"
          CHECK (jsonb_typeof("web_search_queries") = 'array'),
        CONSTRAINT "chk_fact_check_grounding_snapshot_sources_array"
          CHECK (jsonb_typeof("sources") = 'array')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "fact_check_result" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_batch_id" uuid NOT NULL,
        "component_id" uuid NOT NULL,
        "status" "verification_status_enum" NOT NULL,
        "reason" text NOT NULL,
        "checked_at" timestamp with time zone NOT NULL,
        CONSTRAINT "pk_fact_check_result" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_result_batch_component"
          UNIQUE ("fact_check_batch_id", "component_id"),
        CONSTRAINT "fk_fact_check_result_batch"
          FOREIGN KEY ("fact_check_batch_id")
          REFERENCES "fact_check_batch"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fact_check_result_component"
          FOREIGN KEY ("component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fact_check_result_reason_not_blank"
          CHECK (length(btrim("reason")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_result_component_id"
      ON "fact_check_result" ("component_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "fact_check_source" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_result_id" uuid NOT NULL,
        "title" character varying(500) NOT NULL,
        "publisher" character varying(255) NOT NULL,
        "url" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fact_check_source" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_source_result_url"
          UNIQUE ("fact_check_result_id", "url"),
        CONSTRAINT "fk_fact_check_source_result"
          FOREIGN KEY ("fact_check_result_id")
          REFERENCES "fact_check_result"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fact_check_source_title_not_blank"
          CHECK (length(btrim("title")) > 0),
        CONSTRAINT "chk_fact_check_source_publisher_not_blank"
          CHECK (length(btrim("publisher")) > 0),
        CONSTRAINT "chk_fact_check_source_url_not_blank"
          CHECK (length(btrim("url")) > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "judge_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "debate_id" uuid NOT NULL,
        "status" "judge_task_status_enum" NOT NULL DEFAULT 'PENDING',
        "bull_mq_job_id" character varying(255),
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error_code" character varying(100),
        "failure_reason" text,
        "processing_started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_judge_task" PRIMARY KEY ("id"),
        CONSTRAINT "uq_judge_task_debate_id" UNIQUE ("debate_id"),
        CONSTRAINT "fk_judge_task_debate"
          FOREIGN KEY ("debate_id") REFERENCES "debate"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_judge_task_attempt_count_nonnegative"
          CHECK ("attempt_count" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_judge_task_status"
      ON "judge_task" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_judge_task_recovery"
      ON "judge_task" ("status", "processing_started_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This restores the old schema shape only. Deleted task data is not restored.
    await queryRunner.query(`DROP TABLE "judge_task"`);
    await queryRunner.query(`DROP TABLE "fact_check_source"`);
    await queryRunner.query(`DROP TABLE "fact_check_result"`);
    await queryRunner.query(`DROP TABLE "fact_check_grounding_snapshot"`);
    await queryRunner.query(`DROP TABLE "fact_check_stage_task"`);
    await queryRunner.query(`DROP TABLE "fact_check_batch_target"`);
    await queryRunner.query(`DROP TABLE "fact_check_batch"`);
    await queryRunner.query(`DROP TYPE "judge_task_status_enum"`);
    await queryRunner.query(`DROP TYPE "fact_check_stage_task_status_enum"`);
    await queryRunner.query(`DROP TYPE "fact_check_stage_enum"`);
    await queryRunner.query(`DROP TYPE "fact_check_batch_status_enum"`);

    await queryRunner.query(`
      CREATE TYPE "fact_check_batch_task_status_enum" AS ENUM (
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "fact_check_batch_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "turn_id" uuid NOT NULL,
        "status" "fact_check_batch_task_status_enum" NOT NULL
          DEFAULT 'PENDING',
        "bull_mq_job_id" character varying(255),
        "failure_reason" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "processing_started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        CONSTRAINT "pk_fact_check_batch_task" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_batch_task_turn_id" UNIQUE ("turn_id"),
        CONSTRAINT "fk_fact_check_batch_task_turn"
          FOREIGN KEY ("turn_id") REFERENCES "debate_turn"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_batch_task_status"
      ON "fact_check_batch_task" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_batch_task_turn_id"
      ON "fact_check_batch_task" ("turn_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "fact_check_batch_target" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_batch_task_id" uuid NOT NULL,
        "component_id" uuid NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fact_check_batch_target" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_batch_target_task_component"
          UNIQUE ("fact_check_batch_task_id", "component_id"),
        CONSTRAINT "fk_fact_check_batch_target_task"
          FOREIGN KEY ("fact_check_batch_task_id")
          REFERENCES "fact_check_batch_task"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fact_check_batch_target_component"
          FOREIGN KEY ("component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "fact_check_result" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_batch_task_id" uuid NOT NULL,
        "component_id" uuid NOT NULL,
        "status" "verification_status_enum" NOT NULL,
        "reason" text NOT NULL,
        "checked_at" timestamp with time zone NOT NULL,
        CONSTRAINT "pk_fact_check_result" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_result_task_component"
          UNIQUE ("fact_check_batch_task_id", "component_id"),
        CONSTRAINT "fk_fact_check_result_task"
          FOREIGN KEY ("fact_check_batch_task_id")
          REFERENCES "fact_check_batch_task"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fact_check_result_component"
          FOREIGN KEY ("component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fact_check_result_reason_not_blank"
          CHECK (length(btrim("reason")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_fact_check_result_component_id"
      ON "fact_check_result" ("component_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "fact_check_source" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fact_check_result_id" uuid NOT NULL,
        "title" character varying(500) NOT NULL,
        "publisher" character varying(255) NOT NULL,
        "url" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fact_check_source" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_source_result_url"
          UNIQUE ("fact_check_result_id", "url"),
        CONSTRAINT "fk_fact_check_source_result"
          FOREIGN KEY ("fact_check_result_id")
          REFERENCES "fact_check_result"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_fact_check_source_title_not_blank"
          CHECK (length(btrim("title")) > 0),
        CONSTRAINT "chk_fact_check_source_publisher_not_blank"
          CHECK (length(btrim("publisher")) > 0),
        CONSTRAINT "chk_fact_check_source_url_not_blank"
          CHECK (length(btrim("url")) > 0)
      )
    `);
  }
}
