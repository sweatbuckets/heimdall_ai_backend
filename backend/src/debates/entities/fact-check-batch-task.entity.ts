import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { FactCheckBatchTaskStatus } from "../domain/debate.enums";
import { DebateTurnEntity } from "./debate-turn.entity";
import { FactCheckBatchTargetEntity } from "./fact-check-batch-target.entity";
import { FactCheckResultEntity } from "./fact-check-result.entity";

@Entity("fact_check_batch_task")
@Unique("uq_fact_check_batch_task_turn_id", ["turnId"])
@Index("idx_fact_check_batch_task_status", ["status"])
@Index("idx_fact_check_batch_task_turn_id", ["turnId"])
export class FactCheckBatchTaskEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "turn_id", type: "uuid" })
  turnId: string;

  @Column({
    type: "enum",
    enum: FactCheckBatchTaskStatus,
    enumName: "fact_check_batch_task_status_enum",
    default: FactCheckBatchTaskStatus.PENDING,
  })
  status: FactCheckBatchTaskStatus;

  @Column({
    name: "bull_mq_job_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  bullMqJobId: string | null;

  @Column({ name: "failure_reason", type: "text", nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @Column({
    name: "processing_started_at",
    type: "timestamptz",
    nullable: true,
  })
  processingStartedAt: Date | null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null;

  @OneToOne(() => DebateTurnEntity, (turn) => turn.factCheckBatchTask, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "turn_id" })
  turn: DebateTurnEntity;

  @OneToMany(
    () => FactCheckBatchTargetEntity,
    (target) => target.factCheckBatchTask,
  )
  targets: FactCheckBatchTargetEntity[];

  @OneToMany(() => FactCheckResultEntity, (result) => result.factCheckBatchTask)
  results: FactCheckResultEntity[];
}
