import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { DataSource } from "typeorm";
import { AnalyzerAiService } from "./analyzer-ai.service";
import { AnalyzerInputAssembler } from "./analyzer-input.assembler";
import { AnalyzeTurnService } from "./analyze-turn.service";
import { AnalyzeTurnInput, AnalyzeTurnOutput } from "./dto/analyze-turn.dto";
import { AnalyzeTurnConflictError } from "./errors/analyzer.errors";
import {
  DebatePhase,
  DebateSide,
  DebateTurnAnalysisStatus,
} from "../debates/domain/debate.enums";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";

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

  createQueryBuilder(): MockUpdateQueryBuilder {
    return this.completionQueryBuilder;
  }
}

class MockRepository<T extends object> {
  constructor(
    private readonly findOneResult: T | null,
    private readonly countResult = 0,
  ) {}

  async findOne(_options: object): Promise<T | null> {
    return this.findOneResult;
  }

  async count(_options: object): Promise<number> {
    return this.countResult;
  }
}

class MockDataSource {
  public readonly rootQueryBuilders: MockUpdateQueryBuilder[];
  public readonly manager: MockEntityManager;

  constructor(
    rootAffectedResults: number[],
    private readonly turn: Partial<DebateTurnEntity> | null = null,
    private readonly componentCount = 0,
    private readonly factCheckTask: Partial<FactCheckBatchTaskEntity> | null = null,
    completionAffected = 1,
  ) {
    this.rootQueryBuilders = rootAffectedResults.map(
      (affected) => new MockUpdateQueryBuilder(affected),
    );
    this.manager = new MockEntityManager(completionAffected);
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
      return new MockRepository(this.turn);
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
    currentTurn: {
      id: turnId,
      speakerId: "speaker-a",
      speakerSide: DebateSide.SIDE_A,
      phase: DebatePhase.OPENING,
      round: 1,
      sequence: 1,
      content: "Attendance should not count toward grades.",
    },
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
      add: jest.fn(),
    };

    return {
      service: new AnalyzeTurnService(
        dataSource as unknown as DataSource,
        assembler as unknown as AnalyzerInputAssembler,
        aiService as unknown as AnalyzerAiService,
        new MockConfigService() as unknown as ConfigService,
        queue as unknown as Queue,
      ),
      assembler,
      aiService,
    };
  }

  it("claims a PENDING turn and completes empty analyzer output in one transaction", async () => {
    const dataSource = new MockDataSource([1]);
    const { service, assembler, aiService } = createService(dataSource);

    const result = await service.analyzeTurn(turnId);

    expect(assembler.assemble).toHaveBeenCalledWith(turnId);
    expect(aiService.analyze).toHaveBeenCalledWith(input);
    expect(dataSource.manager.inserts).toHaveLength(0);
    expect(dataSource.manager.completionQueryBuilder.sets).toContainEqual({
      analysisStatus: DebateTurnAnalysisStatus.COMPLETED,
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

  it("rejects a PROCESSING turn when the conditional claim update affects no rows", async () => {
    const dataSource = new MockDataSource([0], {
      id: turnId,
      analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
    });
    const { service, assembler, aiService } = createService(dataSource);

    await expect(service.analyzeTurn(turnId)).rejects.toThrow(
      AnalyzeTurnConflictError,
    );
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(aiService.analyze).not.toHaveBeenCalled();
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
});
