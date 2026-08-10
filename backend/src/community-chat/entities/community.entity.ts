import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { MemberEntity } from "../../members/entities/member.entity";
import { CommunityStatus } from "../domain/community-chat.enums";
import { CommunityMemberEntity } from "./community-member.entity";
import { CommunityMessageEntity } from "./community-message.entity";
import { CommunityOpinionEntity } from "./community-opinion.entity";
import { DebateEntity } from "../../debates/entities/debate.entity";

@Entity("community")
export class CommunityEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "host_id", type: "uuid" })
  hostId: string;

  @Column({ type: "varchar", length: 200 })
  title: string;

  @Column({ type: "text" })
  topic: string;

  @Column({ type: "varchar", length: 30 })
  category: string;

  @Column({ type: "varchar", length: 20, default: CommunityStatus.WAITING })
  status: CommunityStatus;

  @Column({ type: "smallint" })
  rounds: number;

  @Column({ name: "is_public", type: "boolean", default: true })
  isPublic: boolean;

  @Column({ name: "host_claim", type: "text", default: "" })
  hostClaim: string;

  @Column({ name: "host_reasons", type: "jsonb", default: () => "'[]'" })
  hostReasons: string[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @ManyToOne(() => MemberEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "host_id" })
  host: MemberEntity;

  @OneToMany(() => CommunityMemberEntity, (member) => member.community)
  members: CommunityMemberEntity[];

  @OneToMany(() => CommunityMessageEntity, (message) => message.community)
  messages: CommunityMessageEntity[];

  @OneToMany(() => CommunityOpinionEntity, (opinion) => opinion.community)
  opinions: CommunityOpinionEntity[];

  @OneToMany(() => DebateEntity, (debate) => debate.community)
  debates: DebateEntity[];
}
