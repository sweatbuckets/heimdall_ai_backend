import * as bcrypt from "bcrypt";
import { UnauthorizedException } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { MemberEntity } from "./entities/member.entity";
import { MembersService } from "./members.service";

describe("MembersService authentication", () => {
  const repository = {
    insert: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  } as unknown as jest.Mocked<Repository<MemberEntity>>;
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(repository),
  } as unknown as DataSource;
  const service = new MembersService(dataSource);

  beforeEach(() => {
    jest.clearAllMocks();
    (dataSource.getRepository as jest.Mock).mockReturnValue(repository);
  });

  it("hashes the password and excludes it from the sign-up response", async () => {
    let inserted: Partial<MemberEntity> | undefined;
    repository.insert.mockImplementation(async (input) => {
      inserted = input as Partial<MemberEntity>;
      return { identifiers: [], generatedMaps: [], raw: [] };
    });
    repository.findOne.mockImplementation(async () =>
      buildMember({
        id: inserted?.id,
        email: inserted?.email,
        passwordHash: inserted?.passwordHash,
      }),
    );

    const result = await service.signUp({
      email: "member@example.com",
      password: "password1234",
      displayName: "회원",
    });

    expect(inserted?.passwordHash).not.toBe("password1234");
    await expect(
      bcrypt.compare("password1234", inserted?.passwordHash ?? ""),
    ).resolves.toBe(true);
    expect(result.email).toBe("member@example.com");
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("returns the member when email and password match", async () => {
    const queryBuilder = mockLoginQueryBuilder(
      buildMember({
        passwordHash: await bcrypt.hash("password1234", 10),
      }),
    );
    repository.createQueryBuilder.mockReturnValue(queryBuilder);

    const result = await service.login({
      email: "member@example.com",
      password: "password1234",
    });

    expect(result.id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("uses the same unauthorized response for an unknown email", async () => {
    repository.createQueryBuilder.mockReturnValue(mockLoginQueryBuilder(null));

    await expect(
      service.login({
        email: "unknown@example.com",
        password: "password1234",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function buildMember(overrides: Partial<MemberEntity> = {}): MemberEntity {
  return Object.assign(new MemberEntity(), {
    id: "00000000-0000-4000-8000-000000000001",
    email: "member@example.com",
    passwordHash: "hash",
    displayName: "회원",
    profileImageUrl: null,
    gender: null,
    age: null,
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    ...overrides,
  });
}

function mockLoginQueryBuilder(member: MemberEntity | null) {
  const queryBuilder = {
    addSelect: jest.fn(),
    where: jest.fn(),
    getOne: jest.fn().mockResolvedValue(member),
  };
  queryBuilder.addSelect.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  return queryBuilder as never;
}
