import { BadRequestException } from "@nestjs/common";
import { StartCommunityDebateRequest } from "../dto/debate.dto";

export function validateStartCommunityDebateRequest(
  body: unknown,
): StartCommunityDebateRequest {
  if (!body || typeof body !== "object") {
    throw new BadRequestException("Request body must be an object.");
  }

  const opponentMemberId = (body as Record<string, unknown>).opponentMemberId;
  if (typeof opponentMemberId !== "string" || opponentMemberId.length === 0) {
    throw new BadRequestException("opponentMemberId is required.");
  }

  return { opponentMemberId };
}
