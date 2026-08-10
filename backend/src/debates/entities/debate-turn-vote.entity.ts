import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { MemberEntity } from "../../members/entities/member.entity";
import { DebateTurnVoteType } from "../domain/debate.enums";
import { DebateTurnEntity } from "./debate-turn.entity";

@Entity("debate_turn_vote")
@Unique("uq_debate_turn_vote_turn_member", ["turnId", "memberId"])
@Index("idx_debate_turn_vote_turn_type", ["turnId", "type"])
@Index("idx_debate_turn_vote_member_id", ["memberId"])
export class DebateTurnVoteEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "turn_id", type: "uuid" })
  turnId: string;

  @Column({ name: "member_id", type: "uuid" })
  memberId: string;

  @Column({
    type: "enum",
    enum: DebateTurnVoteType,
    enumName: "debate_turn_vote_type_enum",
  })
  type: DebateTurnVoteType;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @ManyToOne(() => DebateTurnEntity, (turn) => turn.votes, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "turn_id" })
  turn: DebateTurnEntity;

  @ManyToOne(() => MemberEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "member_id" })
  member: MemberEntity;
}
