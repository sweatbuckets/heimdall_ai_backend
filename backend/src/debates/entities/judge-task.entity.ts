import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { JudgeTaskStatus } from "../domain/debate.enums";
import { DebateEntity } from "./debate.entity";

@Entity("judge_task")
@Unique("uq_judge_task_debate_id", ["debateId"])
@Index("idx_judge_task_status", ["status"])
@Index("idx_judge_task_recovery", ["status", "processingStartedAt"])
export class JudgeTaskEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "debate_id", type: "uuid" })
  debateId: string;

  @Column({
    type: "enum",
    enum: JudgeTaskStatus,
    enumName: "judge_task_status_enum",
    default: JudgeTaskStatus.PENDING,
  })
  status: JudgeTaskStatus;

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

  @OneToOne(() => DebateEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "debate_id" })
  debate: DebateEntity;
}
