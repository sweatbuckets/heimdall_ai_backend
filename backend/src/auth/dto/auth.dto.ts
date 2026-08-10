import { MemberDto } from "../../members/dto/member.dto";

export interface AuthTokenResponseDto {
  member: MemberDto;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface AuthPrincipal {
  memberId: string;
}

export interface JwtAuthPayload {
  sub: string;
  type: "access" | "refresh";
  familyId?: string;
  jti?: string;
  exp?: number;
}
