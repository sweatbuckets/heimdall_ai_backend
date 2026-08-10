import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { MemberDto } from "../members/dto/member.dto";
import { MembersService } from "../members/members.service";
import { AuthService } from "./auth.service";
import { RefreshTokenSessionEntity } from "./entities/refresh-token-session.entity";

describe("AuthService", () => {
  const member: MemberDto = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "member@example.com",
    displayName: "회원",
    profileImageUrl: null,
    gender: null,
    age: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
  const repository = {
    insert: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<RefreshTokenSessionEntity>>;
  const manager = {
    getRepository: jest.fn().mockReturnValue(repository),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(repository),
    transaction: jest.fn(async (work: (value: unknown) => unknown) =>
      work(manager),
    ),
  } as unknown as DataSource;
  const membersService = {
    login: jest.fn().mockResolvedValue(member),
    signUp: jest.fn().mockResolvedValue(member),
    getMember: jest.fn().mockResolvedValue(member),
  } as unknown as MembersService;
  const configService = {
    getOrThrow: jest.fn((key: string) =>
      key === "JWT_ACCESS_SECRET"
        ? "test-access-secret-at-least-32-characters"
        : "test-refresh-secret-at-least-32-characters",
    ),
    get: jest.fn((_key: string, fallback: number) => fallback),
  } as unknown as ConfigService;
  const service = new AuthService(
    new JwtService(),
    configService,
    dataSource,
    membersService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (dataSource.getRepository as jest.Mock).mockReturnValue(repository);
    (dataSource.transaction as jest.Mock).mockImplementation(
      async (work: (value: unknown) => unknown) => work(manager),
    );
    (manager.getRepository as jest.Mock).mockReturnValue(repository);
    (membersService.login as jest.Mock).mockResolvedValue(member);
    (membersService.getMember as jest.Mock).mockResolvedValue(member);
  });

  it("issues signed access and refresh tokens after login", async () => {
    const response = await service.login({
      email: member.email!,
      password: "password1234",
    });

    await expect(
      service.verifyAccessToken(response.accessToken),
    ).resolves.toEqual({ memberId: member.id });
    expect(response.refreshToken).toBeTruthy();
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it("rotates a refresh token and rejects reuse of the old token", async () => {
    let storedSession: RefreshTokenSessionEntity | null = null;
    repository.insert.mockImplementation(async (input) => {
      storedSession = input as RefreshTokenSessionEntity;
      return { identifiers: [], generatedMaps: [], raw: [] };
    });
    repository.save.mockResolvedValue(new RefreshTokenSessionEntity());

    const first = await service.login({
      email: member.email!,
      password: "password1234",
    });
    repository.findOne.mockImplementation(async () => storedSession);

    const second = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(
      service.verifyAccessToken(second.accessToken),
    ).resolves.toEqual({ memberId: member.id });
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
