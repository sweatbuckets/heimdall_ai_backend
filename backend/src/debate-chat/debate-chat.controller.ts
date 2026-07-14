import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { assertUuid } from "../common/http/id.validator";
import {
  DEBATE_TURN_FINALIZE_COMMAND,
  DEBATE_TURN_MESSAGE_SEND_COMMAND,
  DebateChatDraftMessageDto,
  DebateChatCurrentTurnDto,
  DebateChatTurnDto,
  DebateTurnMessageAppendResult,
  DebateTurnFinalizeCommand,
  DebateTurnMessageSendCommand,
} from "./dto/debate-chat.dto";
import {
  DebateChatInputError,
  DebateChatStateError,
} from "./errors/debate-chat.errors";
import { DebateChatService } from "./debate-chat.service";
import { parseDebateChatCommand } from "./validators/debate-chat-command.validator";

export interface DebateChatSnapshotResponse {
  currentTurn: DebateChatCurrentTurnDto | null;
  turns: DebateChatTurnDto[];
  draftMessages: DebateChatDraftMessageDto[];
}

@Controller("debates/:debateId/chat")
export class DebateChatController {
  constructor(private readonly debateChatService: DebateChatService) {}

  @Get()
  async getSnapshot(
    @Param("debateId") debateId: string,
  ): Promise<DebateChatSnapshotResponse> {
    assertUuid(debateId, "debateId");

    return this.debateChatService.getConnectionSnapshot(debateId);
  }

  @Post("messages")
  async appendDraftMessage(
    @Param("debateId") debateId: string,
    @Body() body: unknown,
  ): Promise<DebateTurnMessageAppendResult> {
    assertUuid(debateId, "debateId");

    try {
      const command = buildMessageSendCommand(debateId, body);
      return await this.debateChatService.appendDraftMessage(debateId, command);
    } catch (error) {
      throw mapDebateChatHttpError(error);
    }
  }

  @Post("finalize")
  async finalizeTurn(
    @Param("debateId") debateId: string,
    @Body() body: unknown,
  ): Promise<DebateChatTurnDto> {
    assertUuid(debateId, "debateId");

    try {
      const command = buildFinalizeCommand(debateId, body);
      return await this.debateChatService.finalizeTurn(debateId, command);
    } catch (error) {
      throw mapDebateChatHttpError(error);
    }
  }
}

function buildMessageSendCommand(
  debateId: string,
  body: unknown,
): DebateTurnMessageSendCommand {
  const raw = isRecord(body) ? body : {};
  const command = parseDebateChatCommand(
    JSON.stringify({
      id: readOptionalString(raw, "id") ?? randomUUID(),
      type: DEBATE_TURN_MESSAGE_SEND_COMMAND,
      debateId,
      clientMessageId: readOptionalString(raw, "clientMessageId"),
      payload: readPayload(raw),
      sentAt: readOptionalString(raw, "sentAt"),
    }),
  );

  if (command.type !== DEBATE_TURN_MESSAGE_SEND_COMMAND) {
    throw new BadRequestException("Invalid debate chat command type.");
  }

  return command;
}

function buildFinalizeCommand(
  debateId: string,
  body: unknown,
): DebateTurnFinalizeCommand {
  const raw = isRecord(body) ? body : {};
  const command = parseDebateChatCommand(
    JSON.stringify({
      id: readOptionalString(raw, "id") ?? randomUUID(),
      type: DEBATE_TURN_FINALIZE_COMMAND,
      debateId,
      payload: readPayload(raw),
    }),
  );

  if (command.type !== DEBATE_TURN_FINALIZE_COMMAND) {
    throw new BadRequestException("Invalid debate chat command type.");
  }

  return command;
}

function readPayload(raw: Record<string, unknown>): unknown {
  return isRecord(raw.payload) ? raw.payload : raw;
}

function readOptionalString(
  raw: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = raw[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function mapDebateChatHttpError(error: unknown): Error {
  if (error instanceof BadRequestException) {
    return error;
  }

  if (error instanceof DebateChatInputError) {
    return new BadRequestException(error.message);
  }

  if (error instanceof DebateChatStateError) {
    return new ConflictException(error.message);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unexpected debate chat error.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
