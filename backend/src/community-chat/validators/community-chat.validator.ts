import { BadRequestException } from "@nestjs/common";
import {
  CreateCommunityRequest,
  SaveCommunityOpinionRequest,
  SendCommunityMessageRequest,
  UpdateCommunityDebateIntentRequest,
} from "../dto/community-chat.dto";
import { CommunityDebateIntent } from "../domain/community-chat.enums";

const MAX_MESSAGE_LENGTH = 2000;

export function validateCreateCommunityRequest(
  body: unknown,
): CreateCommunityRequest {
  const record = readRecord(body);
  const hostReasons = record.hostReasons;
  if (
    !Array.isArray(hostReasons) ||
    hostReasons.some(
      (reason) => typeof reason !== "string" || !reason.trim(),
    ) ||
    hostReasons.length > 10
  ) {
    throw new BadRequestException(
      "hostReasons must contain at most 10 non-empty strings.",
    );
  }

  const rounds = record.rounds;
  if (
    typeof rounds !== "number" ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 9
  ) {
    throw new BadRequestException("rounds must be an integer between 1 and 9.");
  }

  if (typeof record.isPublic !== "boolean") {
    throw new BadRequestException("isPublic must be a boolean.");
  }

  return {
    title: readString(record, "title", 200),
    topic: readString(record, "topic", 5000, true),
    category: readString(record, "category", 30),
    rounds,
    isPublic: record.isPublic,
    hostClaim: readString(record, "hostClaim", 2000),
    hostReasons: hostReasons.map((reason) => (reason as string).trim()),
  };
}

export function validateSendCommunityMessageRequest(
  body: unknown,
): SendCommunityMessageRequest {
  const record = readRecord(body);
  return {
    clientMessageId: readString(record, "clientMessageId", 100),
    text: readString(record, "text", MAX_MESSAGE_LENGTH),
  };
}

export function validateSaveCommunityOpinionRequest(
  body: unknown,
): SaveCommunityOpinionRequest {
  const record = readRecord(body);
  const reasons = record.reasons;
  if (
    !Array.isArray(reasons) ||
    reasons.length > 10 ||
    reasons.some(
      (reason) =>
        typeof reason !== "string" ||
        !reason.trim() ||
        reason.trim().length > 2000,
    )
  ) {
    throw new BadRequestException(
      "reasons must contain at most 10 non-empty strings of up to 2000 characters.",
    );
  }
  return {
    claim: readString(record, "claim", 2000),
    reasons: reasons.map((reason) => (reason as string).trim()),
  };
}

export function validateUpdateCommunityDebateIntentRequest(
  body: unknown,
): UpdateCommunityDebateIntentRequest {
  const record = readRecord(body);
  const debateIntent = record.debateIntent;
  if (
    !Object.values(CommunityDebateIntent).includes(
      debateIntent as CommunityDebateIntent,
    )
  ) {
    throw new BadRequestException(
      "debateIntent must be OPEN_TO_DEBATE or PREPARING.",
    );
  }
  return { debateIntent: debateIntent as CommunityDebateIntent };
}

export type ValidatedCommunityCommand =
  | {
      type: "message.send";
      id: string;
      clientMessageId: string;
      text: string;
    }
  | {
      type: "opinion.submit";
      id: string;
      claim: string;
      reasons: string[];
    };

export function validateCommunityCommand(
  raw: unknown,
): ValidatedCommunityCommand {
  const record = readRecord(raw);
  const id = readString(record, "id", 100);
  if (record.type === "message.send") {
    const payload = readRecord(record.payload);
    return {
      type: "message.send",
      id,
      clientMessageId: readString(record, "clientMessageId", 100),
      text: readString(payload, "text", MAX_MESSAGE_LENGTH),
    };
  }
  if (record.type === "opinion.submit") {
    return {
      type: "opinion.submit",
      id,
      ...validateSaveCommunityOpinionRequest(record.payload),
    };
  }
  throw new BadRequestException("Unsupported community chat command.");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
  allowEmpty = false,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > maxLength) {
    throw new BadRequestException(`${field} has an invalid length.`);
  }
  return trimmed;
}
