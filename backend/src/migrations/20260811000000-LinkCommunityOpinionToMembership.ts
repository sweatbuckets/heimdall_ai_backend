import { MigrationInterface, QueryRunner } from "typeorm";

export class LinkCommunityOpinionToMembership20260811000000 implements MigrationInterface {
  name = "LinkCommunityOpinionToMembership20260811000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "community_member" (
        "community_id",
        "member_id",
        "role"
      )
      SELECT
        opinion."community_id",
        opinion."author_id",
        CASE
          WHEN community."host_id" = opinion."author_id" THEN 'HOST'
          ELSE 'MEMBER'
        END
      FROM "community_opinion" opinion
      INNER JOIN "community" community
        ON community."id" = opinion."community_id"
      ON CONFLICT ("community_id", "member_id") DO NOTHING
    `);
    await queryRunner.query(`
      ALTER TABLE "community_opinion"
      DROP CONSTRAINT "fk_community_opinion_author"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_opinion"
      ADD CONSTRAINT "fk_community_opinion_membership"
      FOREIGN KEY ("community_id", "author_id")
      REFERENCES "community_member" ("community_id", "member_id")
      ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_opinion"
      DROP CONSTRAINT "fk_community_opinion_membership"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_opinion"
      ADD CONSTRAINT "fk_community_opinion_author"
      FOREIGN KEY ("author_id") REFERENCES "member" ("id")
      ON DELETE CASCADE
    `);
  }
}
