import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { VerificationStatus } from "../domain/debate.enums";
import { ArgumentComponentEntity } from "./argument-component.entity";
import { FactCheckBatchTaskEntity } from "./fact-check-batch-task.entity";
import { FactCheckSourceEntity } from "./fact-check-source.entity";

@Entity("fact_check_result")
@Unique("uq_fact_check_result_task_component", [
  "factCheckBatchTaskId",
  "componentId",
])
@Index("idx_fact_check_result_component_id", ["componentId"])
export class FactCheckResultEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "fact_check_batch_task_id", type: "uuid" })
  factCheckBatchTaskId: string;

  @Column({ name: "component_id", type: "uuid" })
  componentId: string;

  @Column({
    type: "enum",
    enum: VerificationStatus,
    enumName: "verification_status_enum",
  })
  status: VerificationStatus;

  @Column({ type: "text" })
  reason: string;

  @Column({ name: "checked_at", type: "timestamptz" })
  checkedAt: Date;

  @ManyToOne(() => FactCheckBatchTaskEntity, (task) => task.results, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "fact_check_batch_task_id" })
  factCheckBatchTask: FactCheckBatchTaskEntity;

  @ManyToOne(
    () => ArgumentComponentEntity,
    (component) => component.factCheckResults,
    {
      onDelete: "CASCADE",
    },
  )
  @JoinColumn({ name: "component_id" })
  component: ArgumentComponentEntity;

  @OneToMany(() => FactCheckSourceEntity, (source) => source.factCheckResult)
  sources: FactCheckSourceEntity[];
}
