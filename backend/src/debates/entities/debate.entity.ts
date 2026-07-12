import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { DebatePhase, DebateSide, DebateStatus } from "../domain/debate.enums";
import { DebateTurnEntity } from "./debate-turn.entity";
import { JudgmentResultEntity } from "./judgment-result.entity";
import { MemberEntity } from "../../members/entities/member.entity";

@Entity("debate")
@Index("idx_debate_status", ["status"])
@Index("idx_debate_current_turn", [
  "status",
  "currentPhase",
  "currentRound",
  "currentTurnSide",
])
export class DebateEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 500 })
  topic: string;

  @Column({ name: "side_a_speaker_id", type: "uuid" })
  sideASpeakerId: string;

  @Column({ name: "side_b_speaker_id", type: "uuid" })
  sideBSpeakerId: string;

  @Column({ name: "rebuttal_question_rounds", type: "int" })
  rebuttalQuestionRounds: number;

  @Column({
    type: "enum",
    enum: DebateStatus,
    enumName: "debate_status_enum",
    default: DebateStatus.READY,
  })
  status: DebateStatus;

  @Column({
    name: "current_phase",
    type: "enum",
    enum: DebatePhase,
    enumName: "debate_phase_enum",
    nullable: true,
  })
  currentPhase: DebatePhase | null;

  @Column({ name: "current_round", type: "int", nullable: true })
  currentRound: number | null;

  @Column({
    name: "current_turn_side",
    type: "enum",
    enum: DebateSide,
    enumName: "debate_side_enum",
    nullable: true,
  })
  currentTurnSide: DebateSide | null;

  @Column({
    name: "current_turn_started_at",
    type: "timestamptz",
    nullable: true,
  })
  currentTurnStartedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null;

  @Column({ name: "ended_at", type: "timestamptz", nullable: true })
  endedAt: Date | null;

  @OneToMany(() => DebateTurnEntity, (turn) => turn.debate)
  turns: DebateTurnEntity[];

  @ManyToOne(() => MemberEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "side_a_speaker_id" })
  sideASpeaker: MemberEntity;

  @ManyToOne(() => MemberEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "side_b_speaker_id" })
  sideBSpeaker: MemberEntity;

  @OneToOne(
    () => JudgmentResultEntity,
    (judgmentResult) => judgmentResult.debate,
  )
  judgmentResult: JudgmentResultEntity | null;
}
