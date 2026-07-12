import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { ArgumentalRelationType } from "../domain/debate.enums";
import { ArgumentComponentEntity } from "./argument-component.entity";

@Entity("argumental_relation")
@Unique("uq_argumental_relation_from_to_type", [
  "fromComponentId",
  "toComponentId",
  "type",
])
export class ArgumentalRelationEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "from_component_id", type: "uuid" })
  fromComponentId: string;

  @Column({ name: "to_component_id", type: "uuid" })
  toComponentId: string;

  @Column({
    type: "enum",
    enum: ArgumentalRelationType,
    enumName: "argumental_relation_type_enum",
  })
  type: ArgumentalRelationType;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(
    () => ArgumentComponentEntity,
    (component) => component.outgoingArgumentalRelations,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "from_component_id" })
  fromComponent: ArgumentComponentEntity;

  @ManyToOne(
    () => ArgumentComponentEntity,
    (component) => component.incomingArgumentalRelations,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "to_component_id" })
  toComponent: ArgumentComponentEntity;
}
