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
  Unique,
} from "typeorm";
import {
  DebatePhase,
  DebateSide,
  DebateTurnAnalysisStatus,
} from "../domain/debate.enums";
import { DebateEntity } from "./debate.entity";
import { ArgumentComponentEntity } from "./argument-component.entity";
import { FactCheckBatchTaskEntity } from "./fact-check-batch-task.entity";

@Entity("debate_turn")
@Unique("uq_debate_turn_debate_sequence", ["debateId", "sequence"])
@Index("idx_debate_turn_debate_id", ["debateId"])
@Index("idx_debate_turn_speaker_id", ["speakerId"])
@Index("idx_debate_turn_analysis_status", ["analysisStatus"])
export class DebateTurnEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "debate_id", type: "uuid" })
  debateId: string;

  @Column({ name: "speaker_id", type: "uuid" })
  speakerId: string;

  @Column({
    name: "speaker_side",
    type: "enum",
    enum: DebateSide,
    enumName: "debate_side_enum",
  })
  speakerSide: DebateSide;

  @Column({ type: "enum", enum: DebatePhase, enumName: "debate_phase_enum" })
  phase: DebatePhase;

  @Column({ type: "int" })
  round: number;

  @Column({ type: "int" })
  sequence: number;

  @Column({ type: "text" })
  content: string;

  @Column({
    name: "analysis_status",
    type: "enum",
    enum: DebateTurnAnalysisStatus,
    enumName: "debate_turn_analysis_status_enum",
    default: DebateTurnAnalysisStatus.PENDING,
  })
  analysisStatus: DebateTurnAnalysisStatus;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => DebateEntity, (debate) => debate.turns, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "debate_id" })
  debate: DebateEntity;

  @OneToMany(() => ArgumentComponentEntity, (component) => component.turn)
  components: ArgumentComponentEntity[];

  @OneToOne(() => FactCheckBatchTaskEntity, (task) => task.turn)
  factCheckBatchTask: FactCheckBatchTaskEntity | null;
}
