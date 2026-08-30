import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { FactCheckBatchEntity } from "./fact-check-batch.entity";

export interface FactCheckGroundingSourceSnapshot {
  sourceIndex: number;
  title: string;
  publisher: string;
  url: string;
}

@Entity("fact_check_grounding_snapshot")
@Unique("uq_fact_check_grounding_snapshot_batch_id", ["factCheckBatchId"])
export class FactCheckGroundingSnapshotEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "fact_check_batch_id", type: "uuid" })
  factCheckBatchId: string;

  @Column({ name: "evidence_text", type: "text" })
  evidenceText: string;

  @Column({
    name: "web_search_queries",
    type: "jsonb",
    default: () => "'[]'::jsonb",
  })
  webSearchQueries: string[];

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  sources: FactCheckGroundingSourceSnapshot[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @OneToOne(() => FactCheckBatchEntity, (batch) => batch.groundingSnapshot, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "fact_check_batch_id" })
  factCheckBatch: FactCheckBatchEntity;
}
