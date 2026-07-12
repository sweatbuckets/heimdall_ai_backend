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

  @Column({ name: "display_name", type: "varchar", length: 100 })
  displayName: string;

  @Column({
    name: "profile_image_url",
    type: "varchar",
    length: 1000,
    nullable: true,
  })
  profileImageUrl: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
