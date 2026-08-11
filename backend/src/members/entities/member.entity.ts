import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("member")
export class MemberEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 320, nullable: true, unique: true })
  email: string | null;

  @Column({
    name: "password_hash",
    type: "varchar",
    length: 100,
    nullable: true,
    select: false,
  })
  passwordHash: string | null;

  @Column({ name: "display_name", type: "varchar", length: 100 })
  displayName: string;

  @Column({
    name: "profile_image_url",
    type: "varchar",
    length: 1000,
    nullable: true,
  })
  profileImageUrl: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  gender: string | null;

  @Column({ type: "int", nullable: true })
  age: number | null;

  @Column({ type: "int", default: 0 })
  score: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
