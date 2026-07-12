import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { InteractionalRelationType } from "../domain/debate.enums";
import { ArgumentComponentEntity } from "./argument-component.entity";

@Entity("interactional_relation")
@Unique("uq_interactional_relation_from_to_type", [
  "fromComponentId",
  "toComponentId",
  "type",
])
export class InteractionalRelationEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "from_component_id", type: "uuid" })
  fromComponentId: string;

  @Column({ name: "to_component_id", type: "uuid" })
  toComponentId: string;

  @Column({
    type: "enum",
    enum: InteractionalRelationType,
    enumName: "interactional_relation_type_enum",
  })
  type: InteractionalRelationType;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(
    () => ArgumentComponentEntity,
    (component) => component.outgoingInteractionalRelations,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "from_component_id" })
  fromComponent: ArgumentComponentEntity;

  @ManyToOne(
    () => ArgumentComponentEntity,
    (component) => component.incomingInteractionalRelations,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "to_component_id" })
  toComponent: ArgumentComponentEntity;
}
