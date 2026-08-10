import { MigrationInterface, QueryRunner } from "typeorm";

const LEGACY_COMMUNITY_ID = "c0928cd2-3e12-4720-99e6-7a8121351dbc";

export class ConnectDebateToCommunity20260810000002 implements MigrationInterface {
  name = "ConnectDebateToCommunity20260810000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debate"
      ADD COLUMN "community_id" uuid
    `);
    await queryRunner.query(`
      UPDATE "debate"
      SET "community_id" = '${LEGACY_COMMUNITY_ID}'
      WHERE EXISTS (
        SELECT 1 FROM "community"
        WHERE "id" = '${LEGACY_COMMUNITY_ID}'
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "debate" WHERE "community_id" IS NULL) THEN
          RAISE EXCEPTION
            'Legacy community ${LEGACY_COMMUNITY_ID} is required to backfill debate.community_id';
        END IF;
      END
      $$
    `);
    await queryRunner.query(`
      INSERT INTO "community_member" (
        "community_id",
        "member_id",
        "role",
        "joined_at"
      )
      SELECT DISTINCT
        "community_id",
        "speaker_id",
        'MEMBER',
        "created_at"
      FROM (
        SELECT "community_id", "side_a_speaker_id" AS "speaker_id", "created_at"
        FROM "debate"
        UNION
        SELECT "community_id", "side_b_speaker_id" AS "speaker_id", "created_at"
        FROM "debate"
      ) AS "debate_speaker"
      ON CONFLICT ("community_id", "member_id") DO NOTHING
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      ALTER COLUMN "community_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      ADD CONSTRAINT "fk_debate_community"
      FOREIGN KEY ("community_id") REFERENCES "community"("id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      ADD CONSTRAINT "fk_debate_side_a_community_member"
      FOREIGN KEY ("community_id", "side_a_speaker_id")
      REFERENCES "community_member"("community_id", "member_id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      ADD CONSTRAINT "fk_debate_side_b_community_member"
      FOREIGN KEY ("community_id", "side_b_speaker_id")
      REFERENCES "community_member"("community_id", "member_id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_debate_community_id"
      ON "debate" ("community_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_debate_community_id"`);
    await queryRunner.query(`
      ALTER TABLE "debate"
      DROP CONSTRAINT "fk_debate_side_b_community_member"
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      DROP CONSTRAINT "fk_debate_side_a_community_member"
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      DROP CONSTRAINT "fk_debate_community"
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      DROP COLUMN "community_id"
    `);
  }
}
