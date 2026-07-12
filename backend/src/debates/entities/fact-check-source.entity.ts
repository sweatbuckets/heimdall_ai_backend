import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { FactCheckResultEntity } from "./fact-check-result.entity";

@Entity("fact_check_source")
@Unique("uq_fact_check_source_result_url", ["factCheckResultId", "url"])
export class FactCheckSourceEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "fact_check_result_id", type: "uuid" })
  factCheckResultId: string;

  @Column({ type: "varchar", length: 500 })
  title: string;

  @Column({ type: "varchar", length: 255 })
  publisher: string;

  @Column({ type: "text" })
  url: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => FactCheckResultEntity, (result) => result.sources, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "fact_check_result_id" })
  factCheckResult: FactCheckResultEntity;
}
