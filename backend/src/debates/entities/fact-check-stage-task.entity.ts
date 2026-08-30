import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import {
  FactCheckStage,
  FactCheckStageTaskStatus,
} from "../domain/debate.enums";
import { FactCheckBatchEntity } from "./fact-check-batch.entity";

@Entity("fact_check_stage_task")
@Unique("uq_fact_check_stage_task_batch_stage", ["factCheckBatchId", "stage"])
@Index("idx_fact_check_stage_task_status", ["status"])
@Index("idx_fact_check_stage_task_recovery", ["status", "processingStartedAt"])
export class FactCheckStageTaskEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "fact_check_batch_id", type: "uuid" })
  factCheckBatchId: string;

  @Column({
    type: "enum",
    enum: FactCheckStage,
    enumName: "fact_check_stage_enum",
  })
  stage: FactCheckStage;

  @Column({
    type: "enum",
    enum: FactCheckStageTaskStatus,
    enumName: "fact_check_stage_task_status_enum",
    default: FactCheckStageTaskStatus.PENDING,
  })
  status: FactCheckStageTaskStatus;

  @Column({
    name: "bull_mq_job_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  bullMqJobId: string | null;

  @Column({ name: "attempt_count", type: "int", default: 0 })
  attemptCount: number;

  @Column({
    name: "last_error_code",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  lastErrorCode: string | null;

  @Column({ name: "failure_reason", type: "text", nullable: true })
  failureReason: string | null;

  @Column({
    name: "processing_started_at",
    type: "timestamptz",
    nullable: true,
  })
  processingStartedAt: Date | null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @ManyToOne(() => FactCheckBatchEntity, (batch) => batch.stageTasks, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "fact_check_batch_id" })
  factCheckBatch: FactCheckBatchEntity;
}
