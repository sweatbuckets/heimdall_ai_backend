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

@Entity("community_message")
@Unique("uq_community_message_client", [
  "communityId",
  "authorId",
  "clientMessageId",
])
@Index("idx_community_message_timeline", ["communityId", "createdAt"])
export class CommunityMessageEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "community_id", type: "uuid" })
  communityId: string;

  @Column({ name: "author_id", type: "uuid" })
  authorId: string;

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

  @ManyToOne(() => MemberEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "author_id" })
  author: MemberEntity;
}
