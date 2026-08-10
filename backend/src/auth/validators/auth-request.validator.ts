import { BadRequestException } from "@nestjs/common";
import { RefreshTokenRequest } from "../dto/auth.dto";

export function validateRefreshTokenRequest(
  body: unknown,
): RefreshTokenRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }

  const refreshToken = body.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    throw new BadRequestException("refreshToken must be a non-empty string.");
  }

  return { refreshToken: refreshToken.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
