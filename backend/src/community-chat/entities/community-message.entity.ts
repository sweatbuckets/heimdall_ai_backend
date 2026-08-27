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
import { MemberEntity } from "../../members/entities/member.entity";
import { CommunityEntity } from "./community.entity";

export enum CommunityMessageType {
  TEXT = "TEXT",
  DEBATE_STARTED = "DEBATE_STARTED",
  DEBATE_RESULT = "DEBATE_RESULT",
  DEBATE_FORFEIT = "DEBATE_FORFEIT",
  DEBATE_TIMEOUT = "DEBATE_TIMEOUT",
}

@Entity("community_message")
@Unique("uq_community_message_client", [
  "communityId",
  "authorId",
  "clientMessageId",
])
@Index("idx_community_message_timeline", ["communityId", "createdAt"])
@Index("uq_community_message_debate_event", ["debateId", "type"], {
  unique: true,
  where: '"debate_id" IS NOT NULL',
})
export class CommunityMessageEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "community_id", type: "uuid" })
  communityId: string;

  @Column({ name: "author_id", type: "uuid", nullable: true })
  authorId: string | null;

  @Column({
    name: "message_type",
    type: "varchar",
    length: 30,
    default: CommunityMessageType.TEXT,
  })
  type: CommunityMessageType;

  @Column({ name: "debate_id", type: "uuid", nullable: true })
  debateId: string | null;

  @Column({ name: "client_message_id", type: "varchar", length: 100 })
  clientMessageId: string;

  @Column({ type: "text" })
  body: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => CommunityEntity, (community) => community.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "community_id" })
  community: CommunityEntity;

  @ManyToOne(() => MemberEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "author_id" })
  author: MemberEntity | null;
}
