import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import { DebateTurnEntity } from "./debate-turn.entity";
import { ArgumentalRelationEntity } from "./argumental-relation.entity";
import { InteractionalRelationEntity } from "./interactional-relation.entity";
import { FactCheckBatchTargetEntity } from "./fact-check-batch-target.entity";
import { FactCheckResultEntity } from "./fact-check-result.entity";

@Entity("argument_component")
@Index("idx_argument_component_turn_id", ["turnId"])
@Index("idx_argument_component_requires_fact_check", ["requiresFactCheck"])
export class ArgumentComponentEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "turn_id", type: "uuid" })
  turnId: string;

  @Column({ name: "is_major_claim", type: "boolean" })
  isMajorClaim: boolean;

  @Column({ type: "varchar", length: 1000 })
  statement: string;

  @Column({ name: "requires_fact_check", type: "boolean" })
  requiresFactCheck: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => DebateTurnEntity, (turn) => turn.components, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "turn_id" })
  turn: DebateTurnEntity;

  @OneToMany(
    () => ArgumentalRelationEntity,
    (relation) => relation.fromComponent,
  )
  outgoingArgumentalRelations: ArgumentalRelationEntity[];

  @OneToMany(() => ArgumentalRelationEntity, (relation) => relation.toComponent)
  incomingArgumentalRelations: ArgumentalRelationEntity[];

  @OneToMany(
    () => InteractionalRelationEntity,
    (relation) => relation.fromComponent,
  )
  outgoingInteractionalRelations: InteractionalRelationEntity[];

  @OneToMany(
    () => InteractionalRelationEntity,
    (relation) => relation.toComponent,
  )
  incomingInteractionalRelations: InteractionalRelationEntity[];

  @OneToMany(() => FactCheckBatchTargetEntity, (target) => target.component)
  factCheckBatchTargets: FactCheckBatchTargetEntity[];

  @OneToMany(() => FactCheckResultEntity, (result) => result.component)
  factCheckResults: FactCheckResultEntity[];
}
