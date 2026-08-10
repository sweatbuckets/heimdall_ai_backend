import { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillCommunityHostOpinions20260810000001 implements MigrationInterface {
  name = "BackfillCommunityHostOpinions20260810000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "community_opinion" (
        "community_id",
        "author_id",
        "claim",
        "reasons",
        "created_at",
        "updated_at"
      )
      SELECT
        community."id",
        community."host_id",
        community."host_claim",
        community."host_reasons",
        community."created_at",
        community."updated_at"
      FROM "community"
      WHERE char_length(trim(community."host_claim")) > 0
      ON CONFLICT ("community_id", "author_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 기존 opinion과 구분할 수 없으므로 안전하게 데이터를 삭제하지 않는다.
  }
}
