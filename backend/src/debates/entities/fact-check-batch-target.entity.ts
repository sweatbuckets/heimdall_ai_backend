import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { ArgumentComponentEntity } from "./argument-component.entity";
import { FactCheckBatchEntity } from "./fact-check-batch.entity";

@Entity("fact_check_batch_target")
@Unique("uq_fact_check_batch_target_batch_component", [
  "factCheckBatchId",
  "componentId",
])
@Index("idx_fact_check_batch_target_component_id", ["componentId"])
export class FactCheckBatchTargetEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "fact_check_batch_id", type: "uuid" })
  factCheckBatchId: string;

  @Column({ name: "component_id", type: "uuid" })
  componentId: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => FactCheckBatchEntity, (batch) => batch.targets, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "fact_check_batch_id" })
  factCheckBatch: FactCheckBatchEntity;

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
