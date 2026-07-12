import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import {
  DebatePhase,
  DebateSide,
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchTaskStatus,
  VerificationStatus,
} from "../debates/domain/debate.enums";
import { JudgeAiService } from "./judge-ai.service";
import { JudgeInputAssembler } from "./judge-input.assembler";
import { JudgeService } from "./judge.service";
import { AssembledJudgeInput, JudgeOutput } from "./dto/judge.dto";
import { JudgeConflictError, JudgeInputError } from "./errors/judge.errors";

interface UpdateExecutionResult {
  affected: number;
}

class MockUpdateQueryBuilder {
  constructor(private readonly affected: number) {}

  update(_entity: unknown): this {
    return this;
  }

  set(_values: object): this {
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
  public readonly insertedValues: unknown[] = [];

  constructor(private readonly updateAffected: number) {}

  async insert(_entity: unknown, value: unknown): Promise<void> {
    this.insertedValues.push(value);
  }

  createQueryBuilder(): MockUpdateQueryBuilder {
    return new MockUpdateQueryBuilder(this.updateAffected);
  }
}

class MockDataSource {
  public readonly manager: MockEntityManager;

  constructor(updateAffected: number) {
    this.manager = new MockEntityManager(updateAffected);
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

describe("JudgeService", () => {
  const assembled: AssembledJudgeInput = {
    input: {
      debate: {
        id: "debate-1",
        topic: "Should attendance count toward grades?",
        sideASpeakerId: "speaker-a",
        sideBSpeakerId: "speaker-b",
        rebuttalQuestionRounds: 2,
      },
      argumentGraph: {
        components: [
          {
            id: "component-a",
            speakerId: "speaker-a",
            speakerSide: DebateSide.SIDE_A,
            phase: DebatePhase.OPENING,
            round: 1,
            turnSequence: 1,
            statement: "Attendance should not count toward grades.",
            isMajorClaim: true,
            requiresFactCheck: true,
          },
        ],
        argumentalRelations: [],
        interactionalRelations: [],
      },
      factCheckResults: [
        {
          componentId: "component-a",
          status: VerificationStatus.PARTIALLY_SUPPORTED,
          reason: "Evidence is mixed.",
        },
      ],
    },
    validationContext: {
      debateStatus: DebateStatus.JUDGING,
      turns: [
        {
          id: "turn-1",
          analysisStatus: DebateTurnAnalysisStatus.COMPLETED,
        },
      ],
      factCheckBatchTasks: [
        {
          id: "task-1",
          status: FactCheckBatchTaskStatus.COMPLETED,
        },
      ],
      hasExistingJudgmentResult: false,
    },
  };
  const output: JudgeOutput = {
    sideAArgumentationScore: 33,
    sideAInteractionScore: 24,
    sideAFactualReliabilityScore: 21,
    sideBArgumentationScore: 29,
    sideBInteractionScore: 22,
    sideBFactualReliabilityScore: 18,
    overallReason: "SIDE_A was stronger overall.",
    sideAFeedback: "Good argument structure.",
    sideBFeedback: "Needs stronger evidence.",
  };

  function createService(dataSource: MockDataSource): {
    service: JudgeService;
    assembler: { assemble: jest.Mock<Promise<AssembledJudgeInput>, [string]> };
    aiService: {
      judge: jest.Mock<Promise<JudgeOutput>, [typeof assembled.input]>;
    };
  } {
    const assembler = {
      assemble: jest
        .fn<Promise<AssembledJudgeInput>, [string]>()
        .mockResolvedValue(assembled),
    };
    const aiService = {
      judge: jest
        .fn<Promise<JudgeOutput>, [typeof assembled.input]>()
        .mockResolvedValue(output),
    };

    return {
      service: new JudgeService(
        dataSource as unknown as DataSource,
        assembler as unknown as JudgeInputAssembler,
        aiService as unknown as JudgeAiService,
        new MockConfigService() as unknown as ConfigService,
      ),
      assembler,
      aiService,
    };
  }

  it("saves JudgmentResult and completes Debate in one transaction", async () => {
    const dataSource = new MockDataSource(1);
    const { service, aiService } = createService(dataSource);

    const result = await service.judgeDebate("debate-1");

    expect(aiService.judge).toHaveBeenCalledWith(assembled.input);
    expect(dataSource.manager.insertedValues).toHaveLength(1);
    expect(dataSource.manager.insertedValues[0]).toMatchObject({
      debateId: "debate-1",
      sideATotalScore: 78,
      sideBTotalScore: 69,
    });
    expect(result.debateId).toBe("debate-1");
  });

  it("prevents duplicate JudgmentResult execution before AI call", async () => {
    const dataSource = new MockDataSource(1);
    const { service, assembler, aiService } = createService(dataSource);
    assembler.assemble.mockResolvedValue({
      ...assembled,
      validationContext: {
        ...assembled.validationContext,
        hasExistingJudgmentResult: true,
      },
    });

    await expect(service.judgeDebate("debate-1")).rejects.toThrow(
      JudgeInputError,
    );
    expect(aiService.judge).not.toHaveBeenCalled();
  });

  it("fails the transaction when Debate cannot transition to COMPLETED", async () => {
    const dataSource = new MockDataSource(0);
    const { service } = createService(dataSource);

    await expect(service.judgeDebate("debate-1")).rejects.toThrow(
      JudgeConflictError,
    );
    expect(dataSource.manager.insertedValues).toHaveLength(1);
  });
});
