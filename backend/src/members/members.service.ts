import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { DataSource, QueryFailedError } from "typeorm";
import { DebateEntity } from "../debates/entities/debate.entity";
import {
  CreateMemberRequest,
  LoginMemberRequest,
  MemberDto,
  SignUpMemberRequest,
  UpdateMemberRequest,
} from "./dto/member.dto";
import { MemberEntity } from "./entities/member.entity";

const BCRYPT_SALT_ROUNDS = 10;
const PG_UNIQUE_VIOLATION = "23505";
const DUMMY_PASSWORD_HASH =
  "$2b$10$P3jRv..bS0gDS8tKkfnkmOrEIlvumxbN8oBrj0mCkTTy6hSPGp.2";

@Injectable()
export class MembersService {
  constructor(private readonly dataSource: DataSource) {}

  async signUp(input: SignUpMemberRequest): Promise<MemberDto> {
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    try {
      await this.dataSource.getRepository(MemberEntity).insert({
        id,
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        profileImageUrl: input.profileImageUrl ?? null,
        gender: input.gender ?? null,
        age: input.age ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Email is already registered.");
      }
      throw error;
    }

    return this.getMember(id);
  }

  async login(input: LoginMemberRequest): Promise<MemberDto> {
    const member = await this.dataSource
      .getRepository(MemberEntity)
      .createQueryBuilder("member")
      .addSelect("member.passwordHash")
      .where("member.email = :email", { email: input.email })
      .getOne();

    const matches = await bcrypt.compare(
      input.password,
      member?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!member || !matches) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    if (!member.email || !member.passwordHash) {
      throw new BadRequestException("This member does not support login.");
    }

    return mapMemberToDto(member);
  }

  async createMember(input: CreateMemberRequest): Promise<MemberDto> {
    const id = randomUUID();

    await this.dataSource.getRepository(MemberEntity).insert({
      id,
      email: null,
      passwordHash: null,
      displayName: input.displayName,
      profileImageUrl: input.profileImageUrl ?? null,
      gender: null,
      age: null,
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
    email: member.email,
    displayName: member.displayName,
    profileImageUrl: member.profileImageUrl,
    gender: member.gender,
    age: member.age,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
