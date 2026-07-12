import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDebateAnalysisSchema20260711000000 implements MigrationInterface {
  name = "CreateDebateAnalysisSchema20260711000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "debate_status_enum" AS ENUM (
        'READY',
        'IN_PROGRESS',
        'FINAL_FACT_CHECKING',
        'JUDGING',
        'COMPLETED',
        'FAILED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "debate_side_enum" AS ENUM ('SIDE_A', 'SIDE_B')
    `);
    await queryRunner.query(`
      CREATE TYPE "debate_phase_enum" AS ENUM (
        'OPENING',
        'REBUTTAL_QUESTION',
        'CLOSING'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "argumental_relation_type_enum" AS ENUM (
        'SUPPORTS',
        'ATTACKS'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "interactional_relation_type_enum" AS ENUM (
        'QUESTIONS',
        'ANSWERS'
      )
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
      CREATE TYPE "verification_status_enum" AS ENUM (
        'SUPPORTED',
        'CONTRADICTED',
        'PARTIALLY_SUPPORTED',
        'INSUFFICIENT_EVIDENCE',
        'NOT_VERIFIABLE',
        'OUTDATED_OR_TIME_SENSITIVE'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "judgment_winner_enum" AS ENUM (
        'SIDE_A',
        'SIDE_B',
        'DRAW'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "debate" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "topic" character varying(500) NOT NULL,
        "side_a_speaker_id" uuid NOT NULL,
        "side_b_speaker_id" uuid NOT NULL,
        "rebuttal_question_rounds" integer NOT NULL,
        "status" "debate_status_enum" NOT NULL DEFAULT 'READY',
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "started_at" timestamp with time zone,
        "ended_at" timestamp with time zone,
        CONSTRAINT "pk_debate" PRIMARY KEY ("id"),
        CONSTRAINT "chk_debate_rebuttal_question_rounds_positive"
          CHECK ("rebuttal_question_rounds" > 0),
        CONSTRAINT "chk_debate_topic_not_blank"
          CHECK (length(btrim("topic")) > 0),
        CONSTRAINT "chk_debate_distinct_speakers"
          CHECK ("side_a_speaker_id" <> "side_b_speaker_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_status" ON "debate" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE "debate_turn" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "debate_id" uuid NOT NULL,
        "speaker_id" uuid NOT NULL,
        "speaker_side" "debate_side_enum" NOT NULL,
        "phase" "debate_phase_enum" NOT NULL,
        "round" integer NOT NULL,
        "sequence" integer NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_debate_turn" PRIMARY KEY ("id"),
        CONSTRAINT "uq_debate_turn_debate_sequence"
          UNIQUE ("debate_id", "sequence"),
        CONSTRAINT "fk_debate_turn_debate"
          FOREIGN KEY ("debate_id") REFERENCES "debate"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_debate_turn_round_positive" CHECK ("round" > 0),
        CONSTRAINT "chk_debate_turn_sequence_positive" CHECK ("sequence" > 0),
        CONSTRAINT "chk_debate_turn_content_not_blank"
          CHECK (length(btrim("content")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_turn_debate_id" ON "debate_turn" ("debate_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_turn_speaker_id" ON "debate_turn" ("speaker_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "argument_component" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "turn_id" uuid NOT NULL,
        "is_major_claim" boolean NOT NULL,
        "statement" character varying(1000) NOT NULL,
        "requires_fact_check" boolean NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_argument_component" PRIMARY KEY ("id"),
        CONSTRAINT "fk_argument_component_turn"
          FOREIGN KEY ("turn_id") REFERENCES "debate_turn"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_argument_component_statement_not_blank"
          CHECK (length(btrim("statement")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_argument_component_turn_id"
        ON "argument_component" ("turn_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_argument_component_requires_fact_check"
        ON "argument_component" ("requires_fact_check")
    `);

    await queryRunner.query(`
      CREATE TABLE "argumental_relation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "from_component_id" uuid NOT NULL,
        "to_component_id" uuid NOT NULL,
        "type" "argumental_relation_type_enum" NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_argumental_relation" PRIMARY KEY ("id"),
        CONSTRAINT "uq_argumental_relation_from_to_type"
          UNIQUE ("from_component_id", "to_component_id", "type"),
        CONSTRAINT "fk_argumental_relation_from_component"
          FOREIGN KEY ("from_component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_argumental_relation_to_component"
          FOREIGN KEY ("to_component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_argumental_relation_no_self_reference"
          CHECK ("from_component_id" <> "to_component_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "interactional_relation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "from_component_id" uuid NOT NULL,
        "to_component_id" uuid NOT NULL,
        "type" "interactional_relation_type_enum" NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_interactional_relation" PRIMARY KEY ("id"),
        CONSTRAINT "uq_interactional_relation_from_to_type"
          UNIQUE ("from_component_id", "to_component_id", "type"),
        CONSTRAINT "fk_interactional_relation_from_component"
          FOREIGN KEY ("from_component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_interactional_relation_to_component"
          FOREIGN KEY ("to_component_id")
          REFERENCES "argument_component"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_interactional_relation_no_self_reference"
          CHECK ("from_component_id" <> "to_component_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "fact_check_batch_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "turn_id" uuid NOT NULL,
        "status" "fact_check_batch_task_status_enum" NOT NULL DEFAULT 'PENDING',
        "bull_mq_job_id" character varying(255),
        "failure_reason" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "processing_started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        CONSTRAINT "pk_fact_check_batch_task" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fact_check_batch_task_turn_id" UNIQUE ("turn_id"),
        CONSTRAINT "fk_fact_check_batch_task_turn"
          FOREIGN KEY ("turn_id") REFERENCES "debate_turn"("id") ON DELETE CASCADE
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

    await queryRunner.query(`
      CREATE TABLE "judgment_result" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "debate_id" uuid NOT NULL,
        "winner" "judgment_winner_enum" NOT NULL,
        "side_a_argumentation_score" integer NOT NULL,
        "side_a_interaction_score" integer NOT NULL,
        "side_a_factual_reliability_score" integer NOT NULL,
        "side_a_total_score" integer NOT NULL,
        "side_b_argumentation_score" integer NOT NULL,
        "side_b_interaction_score" integer NOT NULL,
        "side_b_factual_reliability_score" integer NOT NULL,
        "side_b_total_score" integer NOT NULL,
        "overall_reason" text NOT NULL,
        "side_a_feedback" text NOT NULL,
        "side_b_feedback" text NOT NULL,
        "judged_at" timestamp with time zone NOT NULL,
        CONSTRAINT "pk_judgment_result" PRIMARY KEY ("id"),
        CONSTRAINT "uq_judgment_result_debate_id" UNIQUE ("debate_id"),
        CONSTRAINT "fk_judgment_result_debate"
          FOREIGN KEY ("debate_id") REFERENCES "debate"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_judgment_side_a_argumentation_score_range"
          CHECK ("side_a_argumentation_score" BETWEEN 0 AND 40),
        CONSTRAINT "chk_judgment_side_a_interaction_score_range"
          CHECK ("side_a_interaction_score" BETWEEN 0 AND 30),
        CONSTRAINT "chk_judgment_side_a_factual_reliability_score_range"
          CHECK ("side_a_factual_reliability_score" BETWEEN 0 AND 30),
        CONSTRAINT "chk_judgment_side_a_total_score_range"
          CHECK ("side_a_total_score" BETWEEN 0 AND 100),
        CONSTRAINT "chk_judgment_side_b_argumentation_score_range"
          CHECK ("side_b_argumentation_score" BETWEEN 0 AND 40),
        CONSTRAINT "chk_judgment_side_b_interaction_score_range"
          CHECK ("side_b_interaction_score" BETWEEN 0 AND 30),
        CONSTRAINT "chk_judgment_side_b_factual_reliability_score_range"
          CHECK ("side_b_factual_reliability_score" BETWEEN 0 AND 30),
        CONSTRAINT "chk_judgment_side_b_total_score_range"
          CHECK ("side_b_total_score" BETWEEN 0 AND 100),
        CONSTRAINT "chk_judgment_overall_reason_not_blank"
          CHECK (length(btrim("overall_reason")) > 0),
        CONSTRAINT "chk_judgment_side_a_feedback_not_blank"
          CHECK (length(btrim("side_a_feedback")) > 0),
        CONSTRAINT "chk_judgment_side_b_feedback_not_blank"
          CHECK (length(btrim("side_b_feedback")) > 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "judgment_result"`);
    await queryRunner.query(`DROP TABLE "fact_check_source"`);
    await queryRunner.query(`DROP TABLE "fact_check_result"`);
    await queryRunner.query(`DROP TABLE "fact_check_batch_target"`);
    await queryRunner.query(`DROP TABLE "fact_check_batch_task"`);
    await queryRunner.query(`DROP TABLE "interactional_relation"`);
    await queryRunner.query(`DROP TABLE "argumental_relation"`);
    await queryRunner.query(`DROP TABLE "argument_component"`);
    await queryRunner.query(`DROP TABLE "debate_turn"`);
    await queryRunner.query(`DROP TABLE "debate"`);
    await queryRunner.query(`DROP TYPE "judgment_winner_enum"`);
    await queryRunner.query(`DROP TYPE "verification_status_enum"`);
    await queryRunner.query(`DROP TYPE "fact_check_batch_task_status_enum"`);
    await queryRunner.query(`DROP TYPE "interactional_relation_type_enum"`);
    await queryRunner.query(`DROP TYPE "argumental_relation_type_enum"`);
    await queryRunner.query(`DROP TYPE "debate_phase_enum"`);
    await queryRunner.query(`DROP TYPE "debate_side_enum"`);
    await queryRunner.query(`DROP TYPE "debate_status_enum"`);
  }
}
