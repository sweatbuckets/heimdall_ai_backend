import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { ArgumentComponentEntity } from "./argument-component.entity";
import { FactCheckBatchTaskEntity } from "./fact-check-batch-task.entity";

@Entity("fact_check_batch_target")
@Unique("uq_fact_check_batch_target_task_component", [
  "factCheckBatchTaskId",
  "componentId",
])
export class FactCheckBatchTargetEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "fact_check_batch_task_id", type: "uuid" })
  factCheckBatchTaskId: string;

  @Column({ name: "component_id", type: "uuid" })
  componentId: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => FactCheckBatchTaskEntity, (task) => task.targets, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "fact_check_batch_task_id" })
  factCheckBatchTask: FactCheckBatchTaskEntity;

  @ManyToOne(
    () => ArgumentComponentEntity,
    (component) => component.factCheckBatchTargets,
    {
      onDelete: "CASCADE",
    },
  )
  @JoinColumn({ name: "component_id" })
  component: ArgumentComponentEntity;
}
