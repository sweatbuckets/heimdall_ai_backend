import { DebatePhase, DebateSide } from "../../debates/domain/debate.enums";
import {
  DEBATE_TURN_SEND_COMMAND,
  DEBATE_TURN_FINALIZE_COMMAND,
  DEBATE_TURN_MESSAGE_SEND_COMMAND,
  DebateChatClientCommand,
  DebateTurnFinalizeCommand,
  DebateTurnMessageSendCommand,
} from "../dto/debate-chat.dto";
import { DebateChatInputError } from "../errors/debate-chat.errors";

const MAX_TURN_MESSAGE_CONTENT_LENGTH = 1000;

export function parseDebateChatCommand(raw: string): DebateChatClientCommand {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DebateChatInputError("Command payload must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new DebateChatInputError("Command payload must be an object.");
  }

  if (
    parsed.type === DEBATE_TURN_SEND_COMMAND ||
    parsed.type === DEBATE_TURN_MESSAGE_SEND_COMMAND
  ) {
    return validateTurnMessageSendCommand(parsed);
  }

  if (parsed.type === DEBATE_TURN_FINALIZE_COMMAND) {
    return validateTurnFinalizeCommand(parsed);
  }

  throw new DebateChatInputError(
    `Unsupported command type: ${String(parsed.type)}.`,
  );
}

function validateTurnSendCommand(
  raw: Record<string, unknown>,
): DebateTurnMessageSendCommand {
  return validateTurnMessageSendCommand(raw);
}

function validateTurnMessageSendCommand(
  raw: Record<string, unknown>,
): DebateTurnMessageSendCommand {
  const payload = raw.payload;

  if (!isRecord(payload)) {
    throw new DebateChatInputError("Command payload field is required.");
  }

  const command: DebateTurnMessageSendCommand = {
    id: readRequiredString(raw, "id"),
    type:
      raw.type === DEBATE_TURN_SEND_COMMAND
        ? DEBATE_TURN_SEND_COMMAND
        : DEBATE_TURN_MESSAGE_SEND_COMMAND,
    debateId: readOptionalString(raw, "debateId"),
    clientMessageId: readOptionalString(raw, "clientMessageId"),
    payload: {
      speakerId: readRequiredString(payload, "speakerId"),
      speakerSide: readEnum(payload, "speakerSide", DebateSide),
      phase: readEnum(payload, "phase", DebatePhase),
      round: readPositiveInteger(payload, "round"),
      content: readRequiredString(payload, "content").trim(),
    },
    sentAt: readOptionalString(raw, "sentAt"),
  };

  if (command.payload.content.length > MAX_TURN_MESSAGE_CONTENT_LENGTH) {
    throw new DebateChatInputError(
      `Turn message content exceeds maximum length: ${MAX_TURN_MESSAGE_CONTENT_LENGTH}.`,
    );
  }

  return command;
}

function validateTurnFinalizeCommand(
  raw: Record<string, unknown>,
): DebateTurnFinalizeCommand {
  const payload = raw.payload;

  if (!isRecord(payload)) {
    throw new DebateChatInputError("Command payload field is required.");
  }

  return {
    id: readRequiredString(raw, "id"),
    type: DEBATE_TURN_FINALIZE_COMMAND,
    debateId: readOptionalString(raw, "debateId"),
    payload: {
      speakerId: readRequiredString(payload, "speakerId"),
      speakerSide: readEnum(payload, "speakerSide", DebateSide),
      phase: readEnum(payload, "phase", DebatePhase),
      round: readPositiveInteger(payload, "round"),
    },
  };
}

function readRequiredString(
  raw: Record<string, unknown>,
  field: string,
): string {
  const value = raw[field];

  if (typeof value !== "string" || !value.trim()) {
    throw new DebateChatInputError(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalString(
  raw: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = raw[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new DebateChatInputError(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function readPositiveInteger(
  raw: Record<string, unknown>,
  field: string,
): number {
  const value = raw[field];

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DebateChatInputError(`${field} must be a positive integer.`);
  }

  return value;
}

function readEnum<T extends Record<string, string>>(
  raw: Record<string, unknown>,
  field: string,
  targetEnum: T,
): T[keyof T] {
  const value = raw[field];
  const allowedValues = Object.values(targetEnum);

  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new DebateChatInputError(
      `${field} must be one of: ${allowedValues.join(", ")}.`,
    );
  }

  return value as T[keyof T];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
