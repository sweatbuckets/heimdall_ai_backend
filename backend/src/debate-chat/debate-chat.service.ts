import { randomUUID } from "node:crypto";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import Redis from "ioredis";
import { AnalyzerQueueService } from "../analyzer/queues/analyzer-queue.service";
import {
  DebatePhase,
  DebateSide,
  DebateStatus,
  DebateTurnAnalysisStatus,
} from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import {
  DebateChatCurrentTurnDto,
  DebateChatDraftMessageDto,
  DebateChatTurnDto,
  DebateTurnMessageAppendResult,
  DEBATE_TURN_MESSAGE_APPEND_STATUS_APPENDED,
  DEBATE_TURN_MESSAGE_APPEND_STATUS_DUPLICATE,
  DebateTurnFinalizeCommand,
  DebateTurnMessageSendCommand,
} from "./dto/debate-chat.dto";
import {
  DEBATE_CHAT_DRAFT_TTL_SECONDS,
  DEBATE_CHAT_FINALIZE_LOCK_TTL_SECONDS,
  DEBATE_CHAT_REDIS,
} from "./debate-chat.constants";
import {
  DebateChatInputError,
  DebateChatStateError,
} from "./errors/debate-chat.errors";

interface DebateDraftScope {
  debateId: string;
  speakerId: string;
  speakerSide: DebateSide;
  phase: string;
  round: number;
}

interface NextTurnState {
  status: DebateStatus.IN_PROGRESS | DebateStatus.FINAL_FACT_CHECKING;
  currentPhase: DebatePhase | null;
  currentRound: number | null;
  currentTurnSide: DebateSide | null;
  currentTurnStartedAt: Date | null;
}

const MAX_TURN_TOTAL_CONTENT_LENGTH = 1000;
const TURN_TIME_LIMIT_MS = 2 * 60 * 1000;
const TURN_TIME_LIMIT_SECONDS = TURN_TIME_LIMIT_MS / 1000;
const APPEND_DRAFT_MESSAGE_SCRIPT = `
local draftKey = KEYS[1]
local draftCharCountKey = KEYS[2]
local draftKeysKey = KEYS[3]
local finalizeLockKey = KEYS[4]
local draftDedupKey = KEYS[5]

local messageJson = ARGV[1]
local messageLength = tonumber(ARGV[2])
local maxLength = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])
local clientMessageId = ARGV[5]

local currentRaw = redis.call("GET", draftCharCountKey)
local currentLength = 0

if redis.call("EXISTS", finalizeLockKey) == 1 then
  return {-3, 0}
end

if clientMessageId ~= "" then
  local existingMessageJson = redis.call("HGET", draftDedupKey, clientMessageId)
  if existingMessageJson then
    return {2, existingMessageJson}
  end
end

if currentRaw then
  currentLength = tonumber(currentRaw)
elseif redis.call("LLEN", draftKey) > 0 then
  return {-2, 0}
end

if currentLength + messageLength > maxLength then
  return {0, currentLength}
end

local nextLength = currentLength + messageLength

redis.call("RPUSH", draftKey, messageJson)
redis.call("SET", draftCharCountKey, nextLength, "EX", ttlSeconds)
redis.call("EXPIRE", draftKey, ttlSeconds)
redis.call("SADD", draftKeysKey, draftKey)
redis.call("EXPIRE", draftKeysKey, ttlSeconds)

if clientMessageId ~= "" then
  redis.call("HSET", draftDedupKey, clientMessageId, messageJson)
  redis.call("EXPIRE", draftDedupKey, ttlSeconds)
end

return {1, nextLength}
`;
const RELEASE_FINALIZE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end

return 0
`;

@Injectable()
export class DebateChatService implements OnModuleDestroy {
  constructor(
    private readonly dataSource: DataSource,
    private readonly analyzerQueueService: AnalyzerQueueService,
    @Inject(DEBATE_CHAT_REDIS)
    private readonly redis: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  async getConnectionSnapshot(debateId: string): Promise<{
    currentTurn: DebateChatCurrentTurnDto | null;
    turns: DebateChatTurnDto[];
    draftMessages: DebateChatDraftMessageDto[];
  }> {
    const [debate, turns, draftMessages] = await Promise.all([
      this.dataSource.getRepository(DebateEntity).findOne({
        where: { id: debateId },
      }),
      this.getTurns(debateId),
      this.getDraftMessages(debateId),
    ]);

    return {
      currentTurn: debate ? mapCurrentTurnToDto(debate) : null,
      turns,
      draftMessages,
    };
  }

  async appendDraftMessage(
    debateId: string,
    command: DebateTurnMessageSendCommand,
  ): Promise<DebateTurnMessageAppendResult> {
    validateCommandDebateId(debateId, command.debateId);

    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: { id: debateId },
    });

    if (!debate) {
      throw new DebateChatInputError(`Debate not found: ${debateId}.`);
    }

    validateDebateCanReceiveTurn(debate);
    validateMessageSpeaker(debate, command.payload);
    validateCurrentTurn(debate, command.payload);
    validateCurrentTurnTime(debate);

    const message: DebateChatDraftMessageDto = {
      id: randomUUID(),
      debateId,
      ...(command.clientMessageId
        ? { clientMessageId: command.clientMessageId }
        : {}),
      speakerId: command.payload.speakerId,
      speakerSide: command.payload.speakerSide,
      phase: command.payload.phase,
      round: command.payload.round,
      content: command.payload.content,
      createdAt: new Date().toISOString(),
    };

    const draftKey = buildDraftKey(message);
    const draftCharCountKey = buildDraftCharCountKey(message);
    const draftKeysKey = buildDraftKeysKey(debateId);
    const finalizeLockKey = buildFinalizeLockKey(message);
    const draftDedupKey = buildDraftDedupKey(message);
    const appendResult = await this.redis.eval(
      APPEND_DRAFT_MESSAGE_SCRIPT,
      5,
      draftKey,
      draftCharCountKey,
      draftKeysKey,
      finalizeLockKey,
      draftDedupKey,
      JSON.stringify(message),
      String(message.content.length),
      String(MAX_TURN_TOTAL_CONTENT_LENGTH),
      String(DEBATE_CHAT_DRAFT_TTL_SECONDS),
      message.clientMessageId ?? "",
    );

    return parseDraftMessageAppendResult(appendResult, message);
  }

  async finalizeTurn(
    debateId: string,
    command: DebateTurnFinalizeCommand,
  ): Promise<DebateChatTurnDto> {
    validateCommandDebateId(debateId, command.debateId);

    const scope = {
      debateId,
      speakerId: command.payload.speakerId,
      speakerSide: command.payload.speakerSide,
      phase: command.payload.phase,
      round: command.payload.round,
    };
    const draftKey = buildDraftKey(scope);
    const draftCharCountKey = buildDraftCharCountKey(scope);
    const draftDedupKey = buildDraftDedupKey(scope);
    const lockKey = buildFinalizeLockKey(scope);
    const lockAcquired = await this.redis.set(
      lockKey,
      command.id,
      "EX",
      DEBATE_CHAT_FINALIZE_LOCK_TTL_SECONDS,
      "NX",
    );

    if (lockAcquired !== "OK") {
      throw new DebateChatStateError(
        "Turn finalization is already processing.",
      );
    }

    try {
      const rawMessages = await this.redis.lrange(draftKey, 0, -1);
      const draftMessages = rawMessages.map(parseDraftMessage);

      if (draftMessages.length === 0) {
        throw new DebateChatInputError(
          "No draft messages exist for this turn.",
        );
      }

      const content = draftMessages
        .map((message) => message.content.trim())
        .filter(Boolean)
        .join("\n");

      if (!content) {
        throw new DebateChatInputError("Finalized turn content is empty.");
      }

      const turn = await this.dataSource.transaction(async (manager) => {
        const debate = await manager.findOne(DebateEntity, {
          where: { id: debateId },
          lock: { mode: "pessimistic_write" },
        });

        if (!debate) {
          throw new DebateChatInputError(`Debate not found: ${debateId}.`);
        }

        validateDebateCanReceiveTurn(debate);
        validateFinalizeSpeaker(debate, command);
        validateCurrentTurn(debate, command.payload);

        const sequence = await getNextTurnSequence(manager, debateId);
        const now = new Date();
        const nextTurnState = calculateNextTurnState(debate, command.payload);
        const turnEntity: Partial<DebateTurnEntity> = {
          id: randomUUID(),
          debateId,
          speakerId: command.payload.speakerId,
          speakerSide: command.payload.speakerSide,
          phase: command.payload.phase,
          round: command.payload.round,
          sequence,
          content,
          analysisStatus: DebateTurnAnalysisStatus.PENDING,
          createdAt: now,
        };

        await manager.insert(DebateTurnEntity, turnEntity);
        await manager.update(
          DebateEntity,
          { id: debateId, status: DebateStatus.IN_PROGRESS },
          nextTurnState,
        );

        return turnEntity;
      });

      const finalizedTurn = mapTurnToDto(turn);
      await this.redis
        .multi()
        .del(draftKey)
        .del(draftCharCountKey)
        .del(draftDedupKey)
        .srem(buildDraftKeysKey(debateId), draftKey)
        .exec();
      await this.analyzerQueueService.enqueueAnalyzeTurn(finalizedTurn.id);

      return finalizedTurn;
    } finally {
      await this.releaseFinalizeLock(lockKey, command.id);
    }
  }

  private async getTurns(debateId: string): Promise<DebateChatTurnDto[]> {
    const turns = await this.dataSource.getRepository(DebateTurnEntity).find({
      where: { debateId },
      order: { sequence: "ASC" },
    });

    return turns.map((turn) => mapTurnToDto(turn));
  }

  private async getDraftMessages(
    debateId: string,
  ): Promise<DebateChatDraftMessageDto[]> {
    const draftKeys = await this.redis.smembers(buildDraftKeysKey(debateId));

    if (draftKeys.length === 0) {
      return [];
    }

    const draftMessageGroups = await Promise.all(
      draftKeys.map(async (draftKey) => this.redis.lrange(draftKey, 0, -1)),
    );

    return draftMessageGroups
      .flatMap((messages) => messages.map(parseDraftMessage))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async releaseFinalizeLock(
    lockKey: string,
    lockOwner: string,
  ): Promise<void> {
    await this.redis.eval(RELEASE_FINALIZE_LOCK_SCRIPT, 1, lockKey, lockOwner);
  }
}

async function getNextTurnSequence(
  manager: EntityManager,
  debateId: string,
): Promise<number> {
  const rawResult = await manager
    .createQueryBuilder(DebateTurnEntity, "turn")
    .select("COALESCE(MAX(turn.sequence), 0)", "maxSequence")
    .where("turn.debate_id = :debateId", { debateId })
    .getRawOne<{ maxSequence: string | number }>();

  const maxSequence =
    typeof rawResult?.maxSequence === "number"
      ? rawResult.maxSequence
      : Number(rawResult?.maxSequence ?? 0);

  return maxSequence + 1;
}

function validateCommandDebateId(
  urlDebateId: string,
  commandDebateId: string | undefined,
): void {
  if (commandDebateId && commandDebateId !== urlDebateId) {
    throw new DebateChatInputError(
      "Command debateId does not match URL debateId.",
    );
  }
}

function validateDebateCanReceiveTurn(debate: DebateEntity): void {
  if (debate.status !== DebateStatus.IN_PROGRESS) {
    throw new DebateChatStateError(
      `Debate cannot receive turns in status: ${debate.status}.`,
    );
  }
}

function validateMessageSpeaker(
  debate: DebateEntity,
  payload: DebateTurnMessageSendCommand["payload"],
): void {
  validateSpeaker(debate, payload.speakerId, payload.speakerSide);
}

function validateFinalizeSpeaker(
  debate: DebateEntity,
  command: DebateTurnFinalizeCommand,
): void {
  validateSpeaker(
    debate,
    command.payload.speakerId,
    command.payload.speakerSide,
  );
}

function validateSpeaker(
  debate: DebateEntity,
  speakerId: string,
  speakerSide: DebateSide,
): void {
  if (
    speakerSide === DebateSide.SIDE_A &&
    speakerId !== debate.sideASpeakerId
  ) {
    throw new DebateChatInputError("speakerId does not match SIDE_A speaker.");
  }

  if (
    speakerSide === DebateSide.SIDE_B &&
    speakerId !== debate.sideBSpeakerId
  ) {
    throw new DebateChatInputError("speakerId does not match SIDE_B speaker.");
  }
}

function validateCurrentTurn(
  debate: DebateEntity,
  payload:
    | DebateTurnMessageSendCommand["payload"]
    | DebateTurnFinalizeCommand["payload"],
): void {
  if (
    !debate.currentPhase ||
    !debate.currentRound ||
    !debate.currentTurnSide ||
    !debate.currentTurnStartedAt
  ) {
    throw new DebateChatStateError("Debate current turn is not initialized.");
  }

  if (payload.phase !== debate.currentPhase) {
    throw new DebateChatStateError(
      `Command phase does not match current phase: ${debate.currentPhase}.`,
    );
  }

  if (payload.round !== debate.currentRound) {
    throw new DebateChatStateError(
      `Command round does not match current round: ${debate.currentRound}.`,
    );
  }

  if (payload.speakerSide !== debate.currentTurnSide) {
    throw new DebateChatStateError(
      `Command speakerSide does not match current turn side: ${debate.currentTurnSide}.`,
    );
  }
}

function validateCurrentTurnTime(debate: DebateEntity): void {
  if (!debate.currentTurnStartedAt) {
    throw new DebateChatStateError("Debate current turn is not initialized.");
  }

  const elapsedMs = Date.now() - debate.currentTurnStartedAt.getTime();

  if (elapsedMs > TURN_TIME_LIMIT_MS) {
    throw new DebateChatStateError("Current turn time limit has expired.");
  }
}

function calculateNextTurnState(
  debate: DebateEntity,
  payload: DebateTurnFinalizeCommand["payload"],
): NextTurnState {
  const nextStartedAt = new Date();

  if (payload.phase === DebatePhase.OPENING) {
    if (payload.speakerSide === DebateSide.SIDE_A) {
      return {
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.OPENING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_B,
        currentTurnStartedAt: nextStartedAt,
      };
    }

    return {
      status: DebateStatus.IN_PROGRESS,
      currentPhase: DebatePhase.REBUTTAL_QUESTION,
      currentRound: 1,
      currentTurnSide: DebateSide.SIDE_A,
      currentTurnStartedAt: nextStartedAt,
    };
  }

  if (payload.phase === DebatePhase.REBUTTAL_QUESTION) {
    if (payload.speakerSide === DebateSide.SIDE_A) {
      return {
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.REBUTTAL_QUESTION,
        currentRound: payload.round,
        currentTurnSide: DebateSide.SIDE_B,
        currentTurnStartedAt: nextStartedAt,
      };
    }

    if (payload.round < debate.rebuttalQuestionRounds) {
      return {
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.REBUTTAL_QUESTION,
        currentRound: payload.round + 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: nextStartedAt,
      };
    }

    return {
      status: DebateStatus.IN_PROGRESS,
      currentPhase: DebatePhase.CLOSING,
      currentRound: 1,
      currentTurnSide: DebateSide.SIDE_A,
      currentTurnStartedAt: nextStartedAt,
    };
  }

  if (payload.phase === DebatePhase.CLOSING) {
    if (payload.speakerSide === DebateSide.SIDE_A) {
      return {
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.CLOSING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_B,
        currentTurnStartedAt: nextStartedAt,
      };
    }

    return {
      status: DebateStatus.FINAL_FACT_CHECKING,
      currentPhase: null,
      currentRound: null,
      currentTurnSide: null,
      currentTurnStartedAt: null,
    };
  }

  throw new DebateChatStateError("Unsupported debate phase.");
}

function buildDraftKeysKey(debateId: string): string {
  return `debate-chat:draft-keys:${debateId}`;
}

function buildDraftKey(scope: DebateDraftScope): string {
  return [
    "debate-chat:draft",
    scope.debateId,
    scope.speakerId,
    scope.speakerSide,
    scope.phase,
    String(scope.round),
  ].join(":");
}

function buildDraftCharCountKey(scope: DebateDraftScope): string {
  return [
    "debate-chat:draft-char-count",
    scope.debateId,
    scope.speakerId,
    scope.speakerSide,
    scope.phase,
    String(scope.round),
  ].join(":");
}

function buildDraftDedupKey(scope: DebateDraftScope): string {
  return [
    "debate-chat:draft-dedup",
    scope.debateId,
    scope.speakerId,
    scope.speakerSide,
    scope.phase,
    String(scope.round),
  ].join(":");
}

function buildFinalizeLockKey(scope: DebateDraftScope): string {
  return [
    "debate-chat:finalize-lock",
    scope.debateId,
    scope.speakerId,
    scope.speakerSide,
    scope.phase,
    String(scope.round),
  ].join(":");
}

function parseDraftMessageAppendResult(
  result: unknown,
  message: DebateChatDraftMessageDto,
): DebateTurnMessageAppendResult {
  if (!Array.isArray(result) || result.length < 1) {
    throw new DebateChatStateError("Redis append result is invalid.");
  }

  const status = Number(result[0]);

  if (status === 1) {
    return {
      status: DEBATE_TURN_MESSAGE_APPEND_STATUS_APPENDED,
      message,
    };
  }

  if (status === 2) {
    if (typeof result[1] !== "string") {
      throw new DebateChatStateError(
        "Redis duplicate append result is invalid.",
      );
    }

    return {
      status: DEBATE_TURN_MESSAGE_APPEND_STATUS_DUPLICATE,
      message: parseDraftMessage(result[1]),
    };
  }

  if (status === 0) {
    throw new DebateChatInputError(
      `Turn total content exceeds maximum length: ${MAX_TURN_TOTAL_CONTENT_LENGTH}.`,
    );
  }

  if (status === -2) {
    throw new DebateChatStateError(
      "Draft character count is missing for existing draft messages.",
    );
  }

  if (status === -3) {
    throw new DebateChatStateError("Turn finalization is already processing.");
  }

  throw new DebateChatStateError("Redis append result is invalid.");
}

function parseDraftMessage(rawMessage: string): DebateChatDraftMessageDto {
  const parsed: unknown = JSON.parse(rawMessage);

  if (!isDraftMessage(parsed)) {
    throw new DebateChatStateError("Stored draft message is invalid.");
  }

  return parsed;
}

function isDraftMessage(value: unknown): value is DebateChatDraftMessageDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.debateId === "string" &&
    typeof record.speakerId === "string" &&
    typeof record.speakerSide === "string" &&
    typeof record.phase === "string" &&
    typeof record.round === "number" &&
    typeof record.content === "string" &&
    typeof record.createdAt === "string"
  );
}

function mapTurnToDto(turn: Partial<DebateTurnEntity>): DebateChatTurnDto {
  if (
    !turn.id ||
    !turn.debateId ||
    !turn.speakerId ||
    !turn.speakerSide ||
    !turn.phase ||
    !turn.round ||
    !turn.sequence ||
    !turn.content ||
    !turn.createdAt
  ) {
    throw new DebateChatStateError("DebateTurn is missing required fields.");
  }

  return {
    id: turn.id,
    debateId: turn.debateId,
    speakerId: turn.speakerId,
    speakerSide: turn.speakerSide,
    phase: turn.phase,
    round: turn.round,
    sequence: turn.sequence,
    content: turn.content,
    createdAt: turn.createdAt.toISOString(),
  };
}

function mapCurrentTurnToDto(
  debate: DebateEntity,
): DebateChatCurrentTurnDto | null {
  if (
    debate.status !== DebateStatus.IN_PROGRESS ||
    !debate.currentPhase ||
    !debate.currentRound ||
    !debate.currentTurnSide ||
    !debate.currentTurnStartedAt
  ) {
    return null;
  }

  return {
    phase: debate.currentPhase,
    round: debate.currentRound,
    turnSide: debate.currentTurnSide,
    startedAt: debate.currentTurnStartedAt.toISOString(),
    maxDurationSeconds: TURN_TIME_LIMIT_SECONDS,
    maxTotalCharacters: MAX_TURN_TOTAL_CONTENT_LENGTH,
  };
}
