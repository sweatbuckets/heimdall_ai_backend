import { DataSource } from "typeorm";
import Redis from "ioredis";
import {
  DebatePhase,
  DebateSide,
  DebateStatus,
} from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import {
  DEBATE_TURN_MESSAGE_APPEND_STATUS_APPENDED,
  DEBATE_TURN_MESSAGE_APPEND_STATUS_DUPLICATE,
  DEBATE_TURN_MESSAGE_SEND_COMMAND,
  DebateTurnMessageSendCommand,
} from "./dto/debate-chat.dto";
import { DebateChatService } from "./debate-chat.service";
import {
  DebateChatInputError,
  DebateChatStateError,
} from "./errors/debate-chat.errors";
import { AnalyzerQueueService } from "../analyzer/queues/analyzer-queue.service";

class MockRepository<T extends object> {
  constructor(private readonly result: T | null) {}

  async findOne(_options: object): Promise<T | null> {
    return this.result;
  }
}

class MockDataSource {
  constructor(private readonly debate: Partial<DebateEntity> | null) {}

  getRepository(_entity: unknown): MockRepository<Partial<DebateEntity>> {
    return new MockRepository(this.debate);
  }
}

class MockRedis {
  public readonly evalCalls: unknown[][] = [];

  constructor(private readonly evalResult: unknown) {}

  async eval(...args: unknown[]): Promise<unknown> {
    this.evalCalls.push(args);
    return this.evalResult;
  }

  async quit(): Promise<"OK"> {
    return "OK";
  }
}

class MockAnalyzerQueueService {
  async enqueueAnalyzeTurn(_turnId: string): Promise<void> {
    return undefined;
  }
}

describe("DebateChatService", () => {
  const debate: Partial<DebateEntity> = {
    id: "debate-1",
    status: DebateStatus.IN_PROGRESS,
    sideASpeakerId: "speaker-a",
    sideBSpeakerId: "speaker-b",
    currentPhase: DebatePhase.OPENING,
    currentRound: 1,
    currentTurnSide: DebateSide.SIDE_A,
    currentTurnStartedAt: new Date(),
  };

  const command: DebateTurnMessageSendCommand = {
    id: "command-1",
    type: DEBATE_TURN_MESSAGE_SEND_COMMAND,
    debateId: "debate-1",
    payload: {
      speakerId: "speaker-a",
      speakerSide: DebateSide.SIDE_A,
      phase: DebatePhase.OPENING,
      round: 1,
      content: "hello",
    },
  };
  const commandWithClientMessageId: DebateTurnMessageSendCommand = {
    ...command,
    clientMessageId: "client-message-1",
  };

  it("appends draft messages through one Redis Lua script call", async () => {
    const redis = new MockRedis([1, 5]);
    const service = createService(debate, redis);

    const result = await service.appendDraftMessage(
      "debate-1",
      commandWithClientMessageId,
    );

    expect(result.status).toBe(DEBATE_TURN_MESSAGE_APPEND_STATUS_APPENDED);
    expect(result.message.content).toBe("hello");
    expect(redis.evalCalls).toHaveLength(1);

    const evalCall = redis.evalCalls[0];
    expect(evalCall[1]).toBe(5);
    expect(evalCall[2]).toBe(
      "debate-chat:draft:debate-1:speaker-a:SIDE_A:OPENING:1",
    );
    expect(evalCall[3]).toBe(
      "debate-chat:draft-char-count:debate-1:speaker-a:SIDE_A:OPENING:1",
    );
    expect(evalCall[4]).toBe("debate-chat:draft-keys:debate-1");
    expect(evalCall[5]).toBe(
      "debate-chat:finalize-lock:debate-1:speaker-a:SIDE_A:OPENING:1",
    );
    expect(evalCall[6]).toBe(
      "debate-chat:draft-dedup:debate-1:speaker-a:SIDE_A:OPENING:1",
    );
    expect(evalCall[8]).toBe("5");
    expect(evalCall[9]).toBe("1000");
    expect(evalCall[11]).toBe("client-message-1");
  });

  it("returns duplicate append results without creating a new draft message", async () => {
    const existingMessage = {
      id: "message-1",
      debateId: "debate-1",
      clientMessageId: "client-message-1",
      speakerId: "speaker-a",
      speakerSide: DebateSide.SIDE_A,
      phase: DebatePhase.OPENING,
      round: 1,
      content: "hello",
      createdAt: new Date().toISOString(),
    };
    const service = createService(
      debate,
      new MockRedis([2, JSON.stringify(existingMessage)]),
    );

    const result = await service.appendDraftMessage(
      "debate-1",
      commandWithClientMessageId,
    );

    expect(result.status).toBe(DEBATE_TURN_MESSAGE_APPEND_STATUS_DUPLICATE);
    expect(result.message).toEqual(existingMessage);
  });

  it("rejects messages when the Redis Lua script reports total length overflow", async () => {
    const service = createService(debate, new MockRedis([0, 999]));

    await expect(
      service.appendDraftMessage("debate-1", command),
    ).rejects.toThrow(DebateChatInputError);
  });

  it("rejects append when draft messages exist without a character count key", async () => {
    const service = createService(debate, new MockRedis([-2, 0]));

    await expect(
      service.appendDraftMessage("debate-1", command),
    ).rejects.toThrow(DebateChatStateError);
  });

  it("rejects append while turn finalization is processing", async () => {
    const service = createService(debate, new MockRedis([-3, 0]));

    await expect(
      service.appendDraftMessage("debate-1", command),
    ).rejects.toThrow(DebateChatStateError);
  });

  it("releases finalize locks only through owner-token Lua compare-and-delete", async () => {
    const redis = new MockRedis(1);
    const service = createService(debate, redis);

    await (
      service as unknown as {
        releaseFinalizeLock(lockKey: string, lockOwner: string): Promise<void>;
      }
    ).releaseFinalizeLock("lock-key", "command-1");

    expect(redis.evalCalls).toHaveLength(1);
    expect(redis.evalCalls[0][1]).toBe(1);
    expect(redis.evalCalls[0][2]).toBe("lock-key");
    expect(redis.evalCalls[0][3]).toBe("command-1");
  });
});

function createService(
  debate: Partial<DebateEntity> | null,
  redis: MockRedis,
): DebateChatService {
  return new DebateChatService(
    new MockDataSource(debate) as unknown as DataSource,
    new MockAnalyzerQueueService() as unknown as AnalyzerQueueService,
    redis as unknown as Redis,
  );
}
