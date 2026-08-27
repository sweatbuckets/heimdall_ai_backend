import { ConfigService } from "@nestjs/config";
import { Job, Queue } from "bullmq";
import { DataSource } from "typeorm";
import { AnalyzerAiService } from "./analyzer-ai.service";
import { AnalyzerInputAssembler } from "./analyzer-input.assembler";
import { AnalyzeTurnService } from "./analyze-turn.service";
import { AnalyzeTurnInput, AnalyzeTurnOutput } from "./dto/analyze-turn.dto";
import { AnalyzeTurnDependencyPendingError } from "./errors/analyzer.errors";
import { AnalyzeTurnJobData } from "./queues/analyzer-job.data";
import {
  DebatePhase,
  DebateSide,
  DebateStatus,
  DebateTurnAnalysisStatus,
} from "../debates/domain/debate.enums";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";
import { JudgeReadinessService } from "../judge/judge-readiness.service";
import { AiInvocationCancellationService } from "../ai/ai-invocation-cancellation.service";

interface UpdateExecutionResult {
  affected: number;
}

class MockUpdateQueryBuilder {
  public readonly sets: object[] = [];

  constructor(private readonly affected: number) {}

  update(_entity: unknown): this {
    return this;
  }

  set(values: object): this {
    this.sets.push(values);
    return this;
  }

  where(_condition: string, _parameters?: object): this {
    return this;
  }

  andWhere(_condition: string, _parameters?: object): this {
    return this;
  }

  async execute(): Promise<UpdateExecutionResult> {
    return { affected: this.affected };
  }
}

class MockEntityManager {
  public readonly inserts: Array<{ entity: unknown; values: unknown }> = [];
  public readonly completionQueryBuilder: MockUpdateQueryBuilder;

  constructor(completionAffected: number) {
    this.completionQueryBuilder = new MockUpdateQueryBuilder(
      completionAffected,
    );
  }

  async insert(entity: unknown, values: unknown): Promise<void> {
    this.inserts.push({ entity, values });
  }

  async findOne(_entity: unknown, _options: object): Promise<object> {
    return { id: "debate-1", status: DebateStatus.IN_PROGRESS };
  }

  createQueryBuilder(): MockUpdateQueryBuilder {
    return this.completionQueryBuilder;
  }
}

class MockRepository<T extends object> {
  constructor(
    private readonly findOneResult: T | null,
    private readonly countResult = 0,
    private readonly findResult: T[] = [],
  ) {}

  async findOne(_options: object): Promise<T | null> {
    return this.findOneResult;
  }

  async count(_options: object): Promise<number> {
    return this.countResult;
  }

  async find(_options: object): Promise<T[]> {
    return this.findResult;
  }
}

class MockDataSource {
  public readonly allRootQueryBuilders: MockUpdateQueryBuilder[];
  public readonly rootQueryBuilders: MockUpdateQueryBuilder[];
  public readonly manager: MockEntityManager;
  private readonly turn: Partial<DebateTurnEntity> | null;
  private readonly roundTurns: Array<Partial<DebateTurnEntity>>;

  constructor(
    rootAffectedResults: number[],
    turn: Partial<DebateTurnEntity> | null = null,
    private readonly componentCount = 0,
    private readonly factCheckTask: Partial<FactCheckBatchTaskEntity> | null = null,
    completionAffected = 2,
    private readonly incompleteEarlierTurnCount = 0,
    roundTurns?: Array<Partial<DebateTurnEntity>>,
  ) {
    this.allRootQueryBuilders = rootAffectedResults.map(
      (affected) => new MockUpdateQueryBuilder(affected),
    );
    this.rootQueryBuilders = [...this.allRootQueryBuilders];
    this.manager = new MockEntityManager(completionAffected);
    this.turn = turn ?? {
      id: "turn-1",
      debateId: "debate-1",
      phase: DebatePhase.OPENING,
      round: 1,
      sequence: 1,
      analysisStatus: DebateTurnAnalysisStatus.PENDING,
    };
    this.roundTurns = roundTurns ?? [
      this.turn,
      {
        id: "turn-2",
        debateId: "debate-1",
        phase: DebatePhase.OPENING,
        round: 1,
        sequence: 2,
        analysisStatus: DebateTurnAnalysisStatus.PENDING,
      },
    ];
  }

  createQueryBuilder(): MockUpdateQueryBuilder {
    const queryBuilder = this.rootQueryBuilders.shift();

    if (!queryBuilder) {
      throw new Error("Unexpected root query builder call.");
    }

    return queryBuilder;
  }

  getRepository(entity: unknown): MockRepository<object> {
    if (entity === DebateTurnEntity) {
      return new MockRepository(
        this.turn,
        this.incompleteEarlierTurnCount,
        this.roundTurns,
      );
    }

    if (entity === ArgumentComponentEntity) {
      return new MockRepository(null, this.componentCount);
    }

    if (entity === FactCheckBatchTaskEntity) {
      return new MockRepository(this.factCheckTask);
    }

    throw new Error("Unexpected repository entity.");
  }

  async transaction<T>(
    callback: (manager: MockEntityManager) => Promise<T>,
  ): Promise<T> {
    return callback(this.manager);
  }
}

class MockConfigService {
  get<T>(_key: string, defaultValue: T): T {
    return defaultValue;
  }
}

describe("AnalyzeTurnService", () => {
  const turnId = "turn-1";
  const input: AnalyzeTurnInput = {
    debate: {
      id: "debate-1",
      topic: "Should attendance count toward grades?",
      sideASpeakerId: "speaker-a",
      sideBSpeakerId: "speaker-b",
      rebuttalQuestionRounds: 2,
    },
    currentTurns: [
      {
        id: turnId,
        speakerId: "speaker-a",
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.OPENING,
        round: 1,
        sequence: 1,
        content: "Attendance should not count toward grades.",
      },
      {
        id: "turn-2",
        speakerId: "speaker-b",
        speakerSide: DebateSide.SIDE_B,
        phase: DebatePhase.OPENING,
        round: 1,
        sequence: 2,
        content: "Attendance should count toward grades.",
      },
    ],
    accumulatedGraph: {
      components: [],
      argumentalRelations: [],
      interactionalRelations: [],
    },
  };
  const emptyOutput: AnalyzeTurnOutput = {
    newComponents: [],
    newArgumentalRelations: [],
    newInteractionalRelations: [],
  };

  function createService(dataSource: MockDataSource): {
    service: AnalyzeTurnService;
    assembler: { assemble: jest.Mock<Promise<AnalyzeTurnInput>, [string]> };
    aiService: {
      analyze: jest.Mock<Promise<AnalyzeTurnOutput>, [AnalyzeTurnInput]>;
    };
    queue: { add: jest.Mock };
  } {
    const assembler = {
      assemble: jest
        .fn<Promise<AnalyzeTurnInput>, [string]>()
        .mockResolvedValue(input),
    };
    const aiService = {
      analyze: jest
        .fn<Promise<AnalyzeTurnOutput>, [AnalyzeTurnInput]>()
        .mockResolvedValue(emptyOutput),
    };
    const queue = {
      add: jest.fn().mockResolvedValue({ id: "fact-check-job-1" }),
    };

    return {
      service: new AnalyzeTurnService(
        dataSource as unknown as DataSource,
        assembler as unknown as AnalyzerInputAssembler,
        aiService as unknown as AnalyzerAiService,
        new MockConfigService() as unknown as ConfigService,
        queue as unknown as Queue,
        {
          tryStartJudge: jest.fn().mockResolvedValue(undefined),
        } as unknown as JudgeReadinessService,
        new AiInvocationCancellationService(),
      ),
      assembler,
      aiService,
      queue,
    };
  }

  function createJob(
    attemptsMade: number,
    attempts: number,
  ): Job<AnalyzeTurnJobData> {
    return {
      attemptsMade,
      opts: { attempts },
    } as Job<AnalyzeTurnJobData>;
  }

  it("claims both PENDING turns and completes a round in one transaction", async () => {
    const dataSource = new MockDataSource([2]);
    const { service, assembler, aiService } = createService(dataSource);

    const result = await service.analyzeTurn(turnId);

    expect(assembler.assemble).toHaveBeenCalledWith(turnId);
    expect(aiService.analyze).toHaveBeenCalledWith(input, expect.anything());
    expect(dataSource.manager.inserts).toHaveLength(0);
    expect(dataSource.manager.completionQueryBuilder.sets).toContainEqual({
      analysisStatus: DebateTurnAnalysisStatus.COMPLETED,
      analysisProcessingStartedAt: null,
    });
    expect(dataSource.allRootQueryBuilders[0].sets[0]).toEqual({
      analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
      analysisProcessingStartedAt: expect.any(Date),
    });
    expect(result).toEqual({
      turnId,
      componentCount: 0,
      argumentalRelationCount: 0,
      interactionalRelationCount: 0,
      factCheckBatchTaskId: null,
      skipped: false,
    });
  });

  it("waits when another job is processing the same round", async () => {
    const dataSource = new MockDataSource([0], {
      id: turnId,
      analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
    });
    const { service, assembler, aiService } = createService(dataSource);

    await expect(service.analyzeTurn(turnId)).rejects.toThrow(
      AnalyzeTurnDependencyPendingError,
    );
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(aiService.analyze).not.toHaveBeenCalled();
  });

  it("waits without calling Gemini when an earlier turn is incomplete", async () => {
    const dataSource = new MockDataSource(
      [0],
      {
        id: turnId,
        debateId: "debate-1",
        sequence: 2,
        analysisStatus: DebateTurnAnalysisStatus.PENDING,
      },
      0,
      null,
      1,
      1,
    );
    const { service, assembler, aiService } = createService(dataSource);

    await expect(service.analyzeTurn(turnId)).rejects.toThrow(
      AnalyzeTurnDependencyPendingError,
    );
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(aiService.analyze).not.toHaveBeenCalled();
  });

  it("waits for the other speaker before analyzing a round", async () => {
    const onlyTurn = {
      id: turnId,
      debateId: "debate-1",
      phase: DebatePhase.OPENING,
      round: 1,
      sequence: 1,
      analysisStatus: DebateTurnAnalysisStatus.PENDING,
    };
    const dataSource = new MockDataSource([], onlyTurn, 0, null, 2, 0, [
      onlyTurn,
    ]);
    const { service, assembler, aiService } = createService(dataSource);

    await expect(service.analyzeTurn(turnId)).rejects.toThrow(
      AnalyzeTurnDependencyPendingError,
    );
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(aiService.analyze).not.toHaveBeenCalled();
  });

  it("stores both source turns and creates one bounded fact-check batch per turn", async () => {
    const dataSource = new MockDataSource([2, 1, 1]);
    const { service, aiService, queue } = createService(dataSource);
    aiService.analyze.mockResolvedValue({
      newComponents: [
        {
          localKey: "NEW_1",
          turnId: "turn-1",
          statement: "Side A claim",
          isMajorClaim: true,
          requiresFactCheck: true,
        },
        {
          localKey: "NEW_2",
          turnId: "turn-2",
          statement: "Side B claim",
          isMajorClaim: true,
          requiresFactCheck: true,
        },
      ],
      newArgumentalRelations: [],
      newInteractionalRelations: [],
    });

    const result = await service.analyzeTurn(turnId);

    const componentInsert = dataSource.manager.inserts.find(
      ({ entity }) => entity === ArgumentComponentEntity,
    );
    expect(componentInsert?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turnId: "turn-1" }),
        expect.objectContaining({ turnId: "turn-2" }),
      ]),
    );
    const taskInserts = dataSource.manager.inserts.filter(
      ({ entity }) => entity === FactCheckBatchTaskEntity,
    );
    expect(taskInserts.map(({ values }) => values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turnId: "turn-1" }),
        expect.objectContaining({ turnId: "turn-2" }),
      ]),
    );
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(result.componentCount).toBe(2);
  });

  it("returns skipped for a COMPLETED turn without calling Gemini again", async () => {
    const dataSource = new MockDataSource(
      [0],
      {
        id: turnId,
        analysisStatus: DebateTurnAnalysisStatus.COMPLETED,
      },
      0,
      null,
    );
    const { service, assembler, aiService } = createService(dataSource);

    const result = await service.analyzeTurn(turnId);

    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(aiService.analyze).not.toHaveBeenCalled();
    expect(result).toEqual({
      turnId,
      componentCount: 0,
      argumentalRelationCount: 0,
      interactionalRelationCount: 0,
      factCheckBatchTaskId: null,
      skipped: true,
    });
  });

  it("resets PROCESSING turn to PENDING when analyzer fails before final attempt", async () => {
    const dataSource = new MockDataSource([2, 2]);
    const { service, aiService } = createService(dataSource);
    aiService.analyze.mockRejectedValue(new Error("temporary analyzer error"));

    await expect(service.analyzeTurn(turnId, createJob(0, 3))).rejects.toThrow(
      "temporary analyzer error",
    );

    expect(dataSource.allRootQueryBuilders[1].sets).toContainEqual({
      analysisStatus: DebateTurnAnalysisStatus.PENDING,
      analysisProcessingStartedAt: null,
    });
  });

  it("marks PROCESSING turn as FAILED when analyzer fails on final attempt", async () => {
    const dataSource = new MockDataSource([2, 2]);
    const { service, aiService } = createService(dataSource);
    aiService.analyze.mockRejectedValue(new Error("final analyzer error"));

    await expect(service.analyzeTurn(turnId, createJob(2, 3))).rejects.toThrow(
      "final analyzer error",
    );

    expect(dataSource.allRootQueryBuilders[1].sets).toContainEqual({
      analysisStatus: DebateTurnAnalysisStatus.FAILED,
      analysisProcessingStartedAt: null,
    });
  });
});
