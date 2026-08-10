import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { MemberEntity } from "../../members/entities/member.entity";
import { CommunityEntity } from "./community.entity";

@Entity("community_opinion")
@Unique("uq_community_opinion_author", ["communityId", "authorId"])
export class CommunityOpinionEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "community_id", type: "uuid" })
  communityId: string;

  @Column({ name: "author_id", type: "uuid" })
  authorId: string;

  @Column({ type: "text" })
  claim: string;

  @Column({ type: "jsonb", default: () => "'[]'" })
  reasons: string[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @ManyToOne(() => CommunityEntity, (community) => community.opinions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "community_id" })
  community: CommunityEntity;

  @ManyToOne(() => MemberEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "author_id" })
  author: MemberEntity;
}
