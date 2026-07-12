import { BadRequestException } from "@nestjs/common";
import { assertUuid } from "../../common/http/id.validator";
import { CreateDebateRequest } from "../dto/debate.dto";

const MAX_TOPIC_LENGTH = 500;

export function validateCreateDebateRequest(
  body: unknown,
): CreateDebateRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }

  const topic = readRequiredString(body, "topic");
  const sideASpeakerId = readRequiredString(body, "sideASpeakerId");
  const sideBSpeakerId = readRequiredString(body, "sideBSpeakerId");
  const rebuttalQuestionRounds = readPositiveInteger(
    body,
    "rebuttalQuestionRounds",
  );

  if (topic.length > MAX_TOPIC_LENGTH) {
    throw new BadRequestException(
      `topic exceeds maximum length: ${MAX_TOPIC_LENGTH}.`,
    );
  }

  assertUuid(sideASpeakerId, "sideASpeakerId");
  assertUuid(sideBSpeakerId, "sideBSpeakerId");

  if (sideASpeakerId === sideBSpeakerId) {
    throw new BadRequestException(
      "sideASpeakerId and sideBSpeakerId must be different.",
    );
  }

  return {
    topic,
    sideASpeakerId,
    sideBSpeakerId,
    rebuttalQuestionRounds,
  };
}

function readRequiredString(
  body: Record<string, unknown>,
  fieldName: string,
): string {
  const value = body[fieldName];

  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function readPositiveInteger(
  body: Record<string, unknown>,
  fieldName: string,
): number {
  const value = body[fieldName];

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new BadRequestException(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
