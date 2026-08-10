import { createHash, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { DataSource, IsNull } from "typeorm";
import {
  LoginMemberRequest,
  MemberDto,
  SignUpMemberRequest,
} from "../members/dto/member.dto";
import { MembersService } from "../members/members.service";
import {
  AuthPrincipal,
  AuthTokenResponseDto,
  JwtAuthPayload,
} from "./dto/auth.dto";
import { RefreshTokenSessionEntity } from "./entities/refresh-token-session.entity";

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly membersService: MembersService,
  ) {}

  async signUp(input: SignUpMemberRequest): Promise<AuthTokenResponseDto> {
    return this.issueNewSession(await this.membersService.signUp(input));
  }

  async login(input: LoginMemberRequest): Promise<AuthTokenResponseDto> {
    return this.issueNewSession(await this.membersService.login(input));
  }

  async verifyAccessToken(token: string): Promise<AuthPrincipal> {
    const payload = await this.verifyToken(token, this.accessSecret, false);
    if (payload.type !== "access" || !payload.sub) {
      throw new UnauthorizedException("Invalid access token.");
    }
    return { memberId: payload.sub };
  }

  async refresh(refreshToken: string): Promise<AuthTokenResponseDto> {
    const payload = await this.verifyToken(
      refreshToken,
      this.refreshSecret,
      false,
    );
    if (
      payload.type !== "refresh" ||
      !payload.sub ||
      !payload.jti ||
      !payload.familyId
    ) {
      throw new UnauthorizedException("Invalid refresh token.");
    }
    const memberId = payload.sub;
    const refreshJti = payload.jti;
    const familyId = payload.familyId;

    const member = await this.membersService.getMember(memberId);
    const response = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RefreshTokenSessionEntity);
      const current = await repository.findOne({
        where: { jti: refreshJti },
        lock: { mode: "pessimistic_write" },
      });

      const now = new Date();
      const valid =
        current !== null &&
        current.memberId === memberId &&
        current.familyId === familyId &&
        current.tokenHash === hashToken(refreshToken) &&
        current.revokedAt === null &&
        current.expiresAt > now;

      if (!valid) {
        if (current?.revokedAt) {
          await repository.update(
            { familyId: current.familyId, revokedAt: IsNull() },
            { revokedAt: now },
          );
        }
        return null;
      }

      const next = await this.createTokenPair(member, familyId);
      current.revokedAt = now;
      current.replacedByJti = next.refreshJti;
      await repository.save(current);
      await repository.insert(next.session);
      return next.response;
    });

    if (!response) {
      throw new UnauthorizedException("Refresh token is no longer valid.");
    }
    return response;
  }

  async logout(refreshToken: string): Promise<void> {
    let payload: JwtAuthPayload;
    try {
      payload = await this.verifyToken(refreshToken, this.refreshSecret, true);
    } catch {
      return;
    }
    if (payload.type !== "refresh" || !payload.jti) return;

    await this.dataSource
      .getRepository(RefreshTokenSessionEntity)
      .update(
        { jti: payload.jti, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
  }

  private async issueNewSession(
    member: MemberDto,
  ): Promise<AuthTokenResponseDto> {
    const pair = await this.createTokenPair(member, randomUUID());
    await this.dataSource
      .getRepository(RefreshTokenSessionEntity)
      .insert(pair.session);
    return pair.response;
  }

  private async createTokenPair(member: MemberDto, familyId: string) {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: member.id, type: "access" } satisfies JwtAuthPayload,
        {
          secret: this.accessSecret,
          expiresIn: this.accessTtlSeconds,
          jwtid: accessJti,
        },
      ),
      this.jwtService.signAsync(
        {
          sub: member.id,
          type: "refresh",
          familyId,
        } satisfies JwtAuthPayload,
        {
          secret: this.refreshSecret,
          expiresIn: this.refreshTtlSeconds,
          jwtid: refreshJti,
        },
      ),
    ]);

    return {
      refreshJti,
      session: {
        id: randomUUID(),
        memberId: member.id,
        jti: refreshJti,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
        revokedAt: null,
        replacedByJti: null,
      },
      response: { member, accessToken, refreshToken },
    };
  }

  private async verifyToken(
    token: string,
    secret: string,
    ignoreExpiration: boolean,
  ): Promise<JwtAuthPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtAuthPayload>(token, {
        secret,
        ignoreExpiration,
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token.");
    }
  }

  private get accessSecret(): string {
    return this.configService.getOrThrow<string>("JWT_ACCESS_SECRET");
  }

  private get refreshSecret(): string {
    return this.configService.getOrThrow<string>("JWT_REFRESH_SECRET");
  }

  private get accessTtlSeconds(): number {
    return this.configService.get<number>("JWT_ACCESS_TTL_SECONDS", 900);
  }

  private get refreshTtlSeconds(): number {
    return this.configService.get<number>("JWT_REFRESH_TTL_SECONDS", 2592000);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
