import { MigrationInterface, QueryRunner } from "typeorm";

const COMMUNITY_ID = "c0928cd2-3e12-4720-99e6-7a8121351dbc";
const ALICE_ID = "27d6989b-6214-4dfd-ae45-744ba2d5d434";
const BOB_ID = "a71956c0-8900-4f63-b3d9-d6535aa28186";

export class SeedAliceBobCommunityContent20260810000003 implements MigrationInterface {
  name = "SeedAliceBobCommunityContent20260810000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "community_opinion" (
        "id",
        "community_id",
        "author_id",
        "claim",
        "reasons",
        "created_at",
        "updated_at"
      )
      SELECT
        '61000000-0000-4000-8000-000000000001',
        community."id",
        member."id",
        '수업 집중과 학습권 보호를 위해 교내 스마트폰 사용을 전면 금지해야 한다.',
        '["스마트폰 알림과 메신저는 수업 집중을 반복적으로 방해한다.", "명확한 전면 금지 규칙이 있어야 학생과 교사가 동일한 기준을 적용할 수 있다."]'::jsonb,
        community."created_at" + interval '10 seconds',
        community."created_at" + interval '10 seconds'
      FROM "community"
      JOIN "member" ON member."id" = '${ALICE_ID}'
      WHERE community."id" = '${COMMUNITY_ID}'
      ON CONFLICT ("community_id", "author_id") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "community_opinion" (
        "id",
        "community_id",
        "author_id",
        "claim",
        "reasons",
        "created_at",
        "updated_at"
      )
      SELECT
        '61000000-0000-4000-8000-000000000002',
        community."id",
        member."id",
        '전면 금지보다 상황에 맞는 제한과 책임 있는 사용 교육이 더 효과적이다.',
        '["긴급 연락과 학습 도구 활용 등 스마트폰이 필요한 상황이 존재한다.", "금지만으로는 학교 밖에서의 올바른 디지털 사용 습관을 기르기 어렵다."]'::jsonb,
        community."created_at" + interval '20 seconds',
        community."created_at" + interval '20 seconds'
      FROM "community"
      JOIN "member" ON member."id" = '${BOB_ID}'
      WHERE community."id" = '${COMMUNITY_ID}'
      ON CONFLICT ("community_id", "author_id") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "community_message" (
        "id",
        "community_id",
        "author_id",
        "client_message_id",
        "body",
        "created_at"
      )
      SELECT
        message."id"::uuid,
        community."id",
        message."author_id"::uuid,
        message."client_message_id",
        message."body",
        community."created_at" + message."created_offset"
      FROM "community"
      JOIN (
        VALUES
          ('71000000-0000-4000-8000-000000000001', '${ALICE_ID}', 'seed-smartphone-alice-1', '수업 중 스마트폰을 잠깐 확인하는 행동도 주변 학생의 집중을 깨뜨릴 수 있어.', interval '1 minute'),
          ('71000000-0000-4000-8000-000000000002', '${BOB_ID}', 'seed-smartphone-bob-1', '그렇다고 전면 금지까지 하면 긴급 연락이나 수업 활용까지 막히지 않을까?', interval '2 minutes'),
          ('71000000-0000-4000-8000-000000000003', '${ALICE_ID}', 'seed-smartphone-alice-2', '긴급 상황은 교무실을 통하게 하고 수업용 기기는 학교가 별도로 관리하면 돼.', interval '3 minutes'),
          ('71000000-0000-4000-8000-000000000004', '${BOB_ID}', 'seed-smartphone-bob-2', '일률적인 금지보다 수업 시간에는 보관하고 쉬는 시간에는 허용하는 방식이 현실적이라고 봐.', interval '4 minutes'),
          ('71000000-0000-4000-8000-000000000005', '${ALICE_ID}', 'seed-smartphone-alice-3', '쉬는 시간 사용도 사이버 괴롭힘이나 촬영 문제로 이어질 수 있어서 명확한 기준이 필요해.', interval '5 minutes'),
          ('71000000-0000-4000-8000-000000000006', '${BOB_ID}', 'seed-smartphone-bob-3', '그 문제는 사용 교육과 위반 시 제재로 해결해야지 모든 학생의 사용을 막는 건 과도해.', interval '6 minutes')
      ) AS message(
        "id",
        "author_id",
        "client_message_id",
        "body",
        "created_offset"
      ) ON true
      JOIN "member" ON member."id" = message."author_id"::uuid
      WHERE community."id" = '${COMMUNITY_ID}'
      ON CONFLICT ("community_id", "author_id", "client_message_id")
      DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "community_message"
      WHERE "id" IN (
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000002',
        '71000000-0000-4000-8000-000000000003',
        '71000000-0000-4000-8000-000000000004',
        '71000000-0000-4000-8000-000000000005',
        '71000000-0000-4000-8000-000000000006'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "community_opinion"
      WHERE "id" IN (
        '61000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000002'
      )
    `);
  }
}
