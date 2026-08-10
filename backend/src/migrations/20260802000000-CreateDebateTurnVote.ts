import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDebateTurnVote20260802000000 implements MigrationInterface {
  name = "CreateDebateTurnVote20260802000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "debate_turn_vote_type_enum" AS ENUM ('LIKE', 'DISLIKE')
    `);
    await queryRunner.query(`
      CREATE TABLE "debate_turn_vote" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "turn_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "type" "debate_turn_vote_type_enum" NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "pk_debate_turn_vote" PRIMARY KEY ("id"),
        CONSTRAINT "uq_debate_turn_vote_turn_member"
          UNIQUE ("turn_id", "member_id"),
        CONSTRAINT "fk_debate_turn_vote_turn"
          FOREIGN KEY ("turn_id") REFERENCES "debate_turn"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_debate_turn_vote_member"
          FOREIGN KEY ("member_id") REFERENCES "member"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_turn_vote_turn_type"
      ON "debate_turn_vote" ("turn_id", "type")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_turn_vote_member_id"
      ON "debate_turn_vote" ("member_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "debate_turn_vote"
    `);
    await queryRunner.query(`
      DROP TYPE "debate_turn_vote_type_enum"
    `);
  }
}
