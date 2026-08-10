import { BadRequestException } from "@nestjs/common";
import { DebateTurnVoteType } from "../domain/debate.enums";
import { SetDebateTurnVoteRequest } from "../dto/debate-turn-vote.dto";

export function validateSetDebateTurnVoteRequest(
  body: unknown,
): SetDebateTurnVoteRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }

  const type = body.type;
  const allowedTypes = Object.values(DebateTurnVoteType);

  if (!allowedTypes.includes(type as DebateTurnVoteType)) {
    throw new BadRequestException(
      `type must be one of: ${allowedTypes.join(", ")}.`,
    );
  }

  return { type: type as DebateTurnVoteType };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
