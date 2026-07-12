import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { JudgmentWinner } from "../domain/debate.enums";
import { DebateEntity } from "./debate.entity";

@Entity("judgment_result")
@Unique("uq_judgment_result_debate_id", ["debateId"])
export class JudgmentResultEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "debate_id", type: "uuid" })
  debateId: string;

  @Column({
    type: "enum",
    enum: JudgmentWinner,
    enumName: "judgment_winner_enum",
  })
  winner: JudgmentWinner;

  @Column({ name: "side_a_argumentation_score", type: "int" })
  sideAArgumentationScore: number;

  @Column({ name: "side_a_interaction_score", type: "int" })
  sideAInteractionScore: number;

  @Column({ name: "side_a_factual_reliability_score", type: "int" })
  sideAFactualReliabilityScore: number;

  @Column({ name: "side_a_total_score", type: "int" })
  sideATotalScore: number;

  @Column({ name: "side_b_argumentation_score", type: "int" })
  sideBArgumentationScore: number;

  @Column({ name: "side_b_interaction_score", type: "int" })
  sideBInteractionScore: number;

  @Column({ name: "side_b_factual_reliability_score", type: "int" })
  sideBFactualReliabilityScore: number;

  @Column({ name: "side_b_total_score", type: "int" })
  sideBTotalScore: number;

  @Column({ name: "overall_reason", type: "text" })
  overallReason: string;

  @Column({ name: "side_a_feedback", type: "text" })
  sideAFeedback: string;

  @Column({ name: "side_b_feedback", type: "text" })
  sideBFeedback: string;

  @Column({ name: "judged_at", type: "timestamptz" })
  judgedAt: Date;

  @OneToOne(() => DebateEntity, (debate) => debate.judgmentResult, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "debate_id" })
  debate: DebateEntity;
}
