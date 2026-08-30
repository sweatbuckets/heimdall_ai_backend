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
import { DebatePhase, FactCheckBatchStatus } from "../domain/debate.enums";
import { DebateEntity } from "./debate.entity";
import { FactCheckGroundingSnapshotEntity } from "./fact-check-grounding-snapshot.entity";
import { FactCheckBatchTargetEntity } from "./fact-check-batch-target.entity";
import { FactCheckResultEntity } from "./fact-check-result.entity";
import { FactCheckStageTaskEntity } from "./fact-check-stage-task.entity";

@Entity("fact_check_batch")
@Unique("uq_fact_check_batch_debate_phase_round", [
  "debateId",
  "phase",
  "round",
])
@Index("idx_fact_check_batch_status", ["status"])
@Index("idx_fact_check_batch_debate_id", ["debateId"])
export class FactCheckBatchEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "debate_id", type: "uuid" })
  debateId: string;

  @Column({ type: "enum", enum: DebatePhase, enumName: "debate_phase_enum" })
  phase: DebatePhase;

  @Column({ type: "int" })
  round: number;

  @Column({
    type: "enum",
    enum: FactCheckBatchStatus,
    enumName: "fact_check_batch_status_enum",
    default: FactCheckBatchStatus.PENDING,
  })
  status: FactCheckBatchStatus;

  @Column({ name: "failure_reason", type: "text", nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => DebateEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "debate_id" })
  debate: DebateEntity;

  @OneToMany(() => FactCheckStageTaskEntity, (task) => task.factCheckBatch)
  stageTasks: FactCheckStageTaskEntity[];

  @OneToMany(
    () => FactCheckBatchTargetEntity,
    (target) => target.factCheckBatch,
  )
  targets: FactCheckBatchTargetEntity[];

  @OneToMany(() => FactCheckResultEntity, (result) => result.factCheckBatch)
  results: FactCheckResultEntity[];

  @OneToOne(
    () => FactCheckGroundingSnapshotEntity,
    (snapshot) => snapshot.factCheckBatch,
  )
  groundingSnapshot: FactCheckGroundingSnapshotEntity | null;
}
