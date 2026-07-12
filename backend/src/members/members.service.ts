import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { DebateEntity } from "../debates/entities/debate.entity";
import {
  CreateMemberRequest,
  MemberDto,
  UpdateMemberRequest,
} from "./dto/member.dto";
import { MemberEntity } from "./entities/member.entity";

@Injectable()
export class MembersService {
  constructor(private readonly dataSource: DataSource) {}

  async createMember(input: CreateMemberRequest): Promise<MemberDto> {
    const id = randomUUID();

    await this.dataSource.getRepository(MemberEntity).insert({
      id,
      displayName: input.displayName,
      profileImageUrl: input.profileImageUrl ?? null,
    });

    return this.getMember(id);
  }

  async listMembers(): Promise<MemberDto[]> {
    const members = await this.dataSource.getRepository(MemberEntity).find({
      order: { createdAt: "DESC" },
      take: 100,
    });

    return members.map(mapMemberToDto);
  }

  async getMember(id: string): Promise<MemberDto> {
    const member = await this.dataSource.getRepository(MemberEntity).findOne({
      where: { id },
    });

    if (!member) {
      throw new NotFoundException(`Member not found: ${id}.`);
    }

    return mapMemberToDto(member);
  }

  async updateMember(
    id: string,
    input: UpdateMemberRequest,
  ): Promise<MemberDto> {
    await this.assertMemberExists(id);

    await this.dataSource.getRepository(MemberEntity).update(
      { id },
      {
        ...(input.displayName !== undefined
          ? { displayName: input.displayName }
          : {}),
        ...(input.profileImageUrl !== undefined
          ? { profileImageUrl: input.profileImageUrl }
          : {}),
      },
    );

    return this.getMember(id);
  }

  async deleteMember(id: string): Promise<void> {
    await this.assertMemberExists(id);

    const debateCount = await this.dataSource
      .getRepository(DebateEntity)
      .createQueryBuilder("debate")
      .where("debate.side_a_speaker_id = :id", { id })
      .orWhere("debate.side_b_speaker_id = :id", { id })
      .getCount();

    if (debateCount > 0) {
      throw new ConflictException("Member is already used by a debate.");
    }

    await this.dataSource.getRepository(MemberEntity).delete({ id });
  }

  private async assertMemberExists(id: string): Promise<void> {
    const exists = await this.dataSource.getRepository(MemberEntity).exist({
      where: { id },
    });

    if (!exists) {
      throw new NotFoundException(`Member not found: ${id}.`);
    }
  }
}

function mapMemberToDto(member: MemberEntity): MemberDto {
  return {
    id: member.id,
    displayName: member.displayName,
    profileImageUrl: member.profileImageUrl,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}
