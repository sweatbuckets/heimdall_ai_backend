import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDebateSpeakerMemberForeignKeys20260711000003 implements MigrationInterface {
  name = "AddDebateSpeakerMemberForeignKeys20260711000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debate"
      ADD CONSTRAINT "fk_debate_side_a_speaker_member"
      FOREIGN KEY ("side_a_speaker_id")
      REFERENCES "member"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      ADD CONSTRAINT "fk_debate_side_b_speaker_member"
      FOREIGN KEY ("side_b_speaker_id")
      REFERENCES "member"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debate"
      DROP CONSTRAINT "fk_debate_side_b_speaker_member"
    `);
    await queryRunner.query(`
      ALTER TABLE "debate"
      DROP CONSTRAINT "fk_debate_side_a_speaker_member"
    `);
  }
}
