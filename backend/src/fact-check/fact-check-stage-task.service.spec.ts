import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { DataSource } from "typeorm";
import { AiInvocationCancellationService } from "../ai/ai-invocation-cancellation.service";
import {
  DebatePhase,
  DebateSide,
  DebateStatus,
  FactCheckBatchStatus,
  FactCheckStage,
  FactCheckStageTaskStatus,
  VerificationStatus,
} from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { FactCheckBatchEntity } from "../debates/entities/fact-check-batch.entity";
import { FactCheckGroundingSnapshotEntity } from "../debates/entities/fact-check-grounding-snapshot.entity";
import { FactCheckResultEntity } from "../debates/entities/fact-check-result.entity";
import { FactCheckSourceEntity } from "../debates/entities/fact-check-source.entity";
import { FactCheckStageTaskEntity } from "../debates/entities/fact-check-stage-task.entity";
import { FactCheckGroundingTaskService } from "./fact-check-grounding-task.service";
import { FactCheckInputAssembler } from "./fact-check-input.assembler";
import { FactCheckQueueService } from "./fact-check-queue.service";
import { FactCheckSynthesisTaskService } from "./fact-check-synthesis-task.service";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import {
  FactCheckBatchInput,
  GroundedEvidenceBundle,
} from "./dto/fact-check-batch.dto";
import { FactCheckStageJobData } from "./queues/fact-check.constants";

class MockUpdateQueryBuilder {
  constructor(private readonly affected = 1) {}

  update(): this {
    return this;
  }
  set(): this {
    return this;
  }
  where(): this {
    return this;
  }
  andWhere(): this {
    return this;
  }
  async execute(): Promise<{ affected: number }> {
    return { affected: this.affected };
  }
}

class MockManager {
  readonly inserts: Array<{ entity: unknown; values: unknown }> = [];
  readonly updates: Array<{
    entity: unknown;
    criteria: unknown;
    values: unknown;
  }> = [];

  constructor(private readonly stage: FactCheckStage) {}

  async findOne(entity: unknown): Promise<object | null> {
    if (entity === FactCheckStageTaskEntity) {
      return {
        id: "task-1",
        factCheckBatchId: "batch-1",
        stage: this.stage,
        status: FactCheckStageTaskStatus.PROCESSING,
      };
    }
    if (entity === FactCheckBatchEntity) {
      return {
        id: "batch-1",
        debateId: "debate-1",
        status:
          this.stage === FactCheckStage.GROUNDING
            ? FactCheckBatchStatus.PENDING
            : FactCheckBatchStatus.PROCESSING,
      };
    }
    if (entity === DebateEntity) {
      return { id: "debate-1", status: DebateStatus.DEBATE_FINALIZED };
    }
    return null;
  }

  async insert(entity: unknown, values: unknown): Promise<void> {
    this.inserts.push({ entity, values });
  }

  async update(
    entity: unknown,
    criteria: unknown,
    values: unknown,
  ): Promise<{ affected: number }> {
    this.updates.push({ entity, criteria, values });
    return { affected: 1 };
  }
}

class MockDataSource {
  readonly manager: MockManager;

  constructor(stage: FactCheckStage) {
    this.manager = new MockManager(stage);
  }

  createQueryBuilder(): MockUpdateQueryBuilder {
    return new MockUpdateQueryBuilder();
  }

  getRepository(entity: unknown): { findOne: jest.Mock } {
    if (entity === FactCheckStageTaskEntity) {
      return {
        findOne: jest.fn().mockResolvedValue({
          id: "task-1",
          factCheckBatchId: "batch-1",
          stage: FactCheckStage.SYNTHESIS,
          status: FactCheckStageTaskStatus.PROCESSING,
        }),
      };
    }
    throw new Error("Unexpected repository entity.");
  }

  async transaction<T>(work: (manager: MockManager) => Promise<T>): Promise<T> {
    return work(this.manager);
  }
}

const input: FactCheckBatchInput = {
  debate: { id: "debate-1", topic: "Topic" },
  round: { phase: DebatePhase.OPENING, number: 1 },
  targets: [
    {
      componentId: "component-a",
      statement: "Side A factual claim",
      turnId: "turn-a",
      sequence: 1,
      speakerSide: DebateSide.SIDE_A,
    },
    {
      componentId: "component-b",
      statement: "Side B factual claim",
      turnId: "turn-b",
      sequence: 2,
      speakerSide: DebateSide.SIDE_B,
    },
  ],
};

const evidence: GroundedEvidenceBundle = {
  evidenceText: "Evidence",
  webSearchQueries: ["query"],
  sources: Array.from({ length: 9 }, (_, sourceIndex) => ({
    sourceIndex,
    title: `Source ${sourceIndex}`,
    publisher: "example.com",
    url: `https://example.com/source-${sourceIndex}`,
  })),
};

const job = {
  attemptsMade: 0,
  opts: { attempts: 2 },
} as Job<FactCheckStageJobData>;

describe("Fact-check stage task services", () => {
  it("stores grounding once and creates exactly one synthesis task", async () => {
    const dataSource = new MockDataSource(FactCheckStage.GROUNDING);
    const assembler = { assembleForTask: jest.fn().mockResolvedValue(input) };
    const aiService = { ground: jest.fn().mockResolvedValue(evidence) };
    const queueService = {
      enqueueSynthesisTask: jest.fn().mockResolvedValue("job-id"),
    };
    const service = new FactCheckGroundingTaskService(
      dataSource as unknown as DataSource,
      assembler as unknown as FactCheckInputAssembler,
      aiService as unknown as FactCheckerAiService,
      queueService as unknown as FactCheckQueueService,
      new ConfigService(),
      new AiInvocationCancellationService(),
    );

    await service.process("task-1", job);

    expect(aiService.ground).toHaveBeenCalledTimes(1);
    expect(
      dataSource.manager.inserts.filter(
        (insert) => insert.entity === FactCheckGroundingSnapshotEntity,
      ),
    ).toHaveLength(1);
    const synthesisInserts = dataSource.manager.inserts.filter(
      (insert) => insert.entity === FactCheckStageTaskEntity,
    );
    expect(synthesisInserts).toHaveLength(1);
    expect(synthesisInserts[0].values).toEqual(
      expect.objectContaining({
        factCheckBatchId: "batch-1",
        stage: FactCheckStage.SYNTHESIS,
        status: FactCheckStageTaskStatus.PENDING,
      }),
    );
    expect(queueService.enqueueSynthesisTask).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues the pending synthesis task when grounding already completed", async () => {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          id: "task-1",
          factCheckBatchId: "batch-1",
          stage: FactCheckStage.GROUNDING,
          status: FactCheckStageTaskStatus.COMPLETED,
        })
        .mockResolvedValueOnce({
          id: "synthesis-task-1",
          factCheckBatchId: "batch-1",
          stage: FactCheckStage.SYNTHESIS,
          status: FactCheckStageTaskStatus.PENDING,
        }),
    };
    const dataSource = {
      createQueryBuilder: () => new MockUpdateQueryBuilder(0),
      getRepository: () => repository,
      transaction: async () => false,
    };
    const aiService = { ground: jest.fn() };
    const queueService = {
      enqueueSynthesisTask: jest.fn().mockResolvedValue("job-id"),
    };
    const service = new FactCheckGroundingTaskService(
      dataSource as unknown as DataSource,
      {} as FactCheckInputAssembler,
      aiService as unknown as FactCheckerAiService,
      queueService as unknown as FactCheckQueueService,
      new ConfigService(),
      new AiInvocationCancellationService(),
    );

    await service.process("task-1", job);

    expect(aiService.ground).not.toHaveBeenCalled();
    expect(queueService.enqueueSynthesisTask).toHaveBeenCalledWith(
      "synthesis-task-1",
    );
  });

  it("synthesizes from the stored snapshot without calling grounding", async () => {
    const dataSource = new MockDataSource(FactCheckStage.SYNTHESIS);
    const assembler = {
      assembleSynthesisForTask: jest
        .fn()
        .mockResolvedValue({ input, groundedEvidence: evidence }),
    };
    const aiService = {
      synthesize: jest.fn().mockResolvedValue({
        results: [
          {
            componentId: input.targets[0].componentId,
            status: VerificationStatus.SUPPORTED,
            reason: "Supported.",
            sourceIndexes: Array.from({ length: 9 }, (_, index) => index),
          },
          {
            componentId: input.targets[1].componentId,
            status: VerificationStatus.SUPPORTED,
            reason: "Supported.",
            sourceIndexes: [0],
          },
        ],
      }),
      ground: jest.fn(),
    };
    const service = new FactCheckSynthesisTaskService(
      dataSource as unknown as DataSource,
      assembler as unknown as FactCheckInputAssembler,
      aiService as unknown as FactCheckerAiService,
      new ConfigService(),
      new AiInvocationCancellationService(),
    );

    await service.process("task-1", job);

    expect(aiService.synthesize).toHaveBeenCalledTimes(1);
    expect(aiService.ground).not.toHaveBeenCalled();
    expect(
      dataSource.manager.inserts.filter(
        (insert) => insert.entity === FactCheckResultEntity,
      ),
    ).toHaveLength(1);
    expect(
      dataSource.manager.inserts.filter(
        (insert) => insert.entity === FactCheckSourceEntity,
      )[0].values,
    ).toHaveLength(6);
  });
});
