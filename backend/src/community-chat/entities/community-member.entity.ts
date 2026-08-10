import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { MemberEntity } from "../../members/entities/member.entity";
import {
  CommunityDebateIntent,
  CommunityMemberRole,
} from "../domain/community-chat.enums";
import { CommunityEntity } from "./community.entity";

@Entity("community_member")
export class CommunityMemberEntity {
  @PrimaryColumn({ name: "community_id", type: "uuid" })
  communityId: string;

  @PrimaryColumn({ name: "member_id", type: "uuid" })
  memberId: string;

  @Column({ type: "varchar", length: 20 })
  role: CommunityMemberRole;

  @Column({
    name: "debate_intent",
    type: "varchar",
    length: 30,
    default: CommunityDebateIntent.OPEN_TO_DEBATE,
  })
  debateIntent: CommunityDebateIntent;

  @CreateDateColumn({ name: "joined_at", type: "timestamptz" })
  joinedAt: Date;

  @ManyToOne(() => CommunityEntity, (community) => community.members, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "community_id" })
  community: CommunityEntity;

  @ManyToOne(() => MemberEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "member_id" })
  member: MemberEntity;
}
