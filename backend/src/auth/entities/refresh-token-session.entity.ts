import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { MemberEntity } from "../../members/entities/member.entity";

@Entity("refresh_token_session")
@Index("uq_refresh_token_session_jti", ["jti"], { unique: true })
@Index("idx_refresh_token_session_member_id", ["memberId"])
@Index("idx_refresh_token_session_family_id", ["familyId"])
@Index("idx_refresh_token_session_expires_at", ["expiresAt"])
export class RefreshTokenSessionEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "member_id", type: "uuid" })
  memberId: string;

  @Column({ type: "uuid" })
  jti: string;

  @Column({ name: "family_id", type: "uuid" })
  familyId: string;

  @Column({ name: "token_hash", type: "char", length: 64 })
  tokenHash: string;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt: Date;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt: Date | null;

  @Column({ name: "replaced_by_jti", type: "uuid", nullable: true })
  replacedByJti: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => MemberEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "member_id" })
  member: MemberEntity;
}
