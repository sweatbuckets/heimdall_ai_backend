import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { DebateTurnAnalysisStatus } from "../debates/domain/debate.enums";
import { AnalyzerRecoveryScheduler } from "./analyzer-recovery.scheduler";
import { AnalyzerQueueService } from "./queues/analyzer-queue.service";

function createUpdateQueryBuilder(affected: number) {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
}

describe("AnalyzerRecoveryScheduler", () => {
  const staleStartedAt = new Date("2026-07-21T00:00:00.000Z");
  const find = jest.fn();
  const enqueueRecoveredAnalyzeTurn = jest.fn();
  const addInterval = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    find.mockResolvedValue([]);
    enqueueRecoveredAnalyzeTurn.mockResolvedValue("recovery-job-id");
  });

  it("registers the analyzer recovery interval", () => {
    const scheduler = new AnalyzerRecoveryScheduler(
      {
        getRepository: jest.fn().mockReturnValue({ find }),
      } as unknown as DataSource,
      { enqueueRecoveredAnalyzeTurn } as unknown as AnalyzerQueueService,
      new ConfigService({ ANALYZER_RECOVERY_INTERVAL_MS: 30_000 }),
      { addInterval } as unknown as SchedulerRegistry,
    );

    scheduler.onApplicationBootstrap();

    expect(addInterval).toHaveBeenCalledWith(
      "analyzer-recovery",
      expect.anything(),
    );
    clearInterval(addInterval.mock.calls[0][1] as NodeJS.Timeout);
  });

  it("resets and re-enqueues a stale PROCESSING turn", async () => {
    find.mockResolvedValue([
      {
        id: "turn-1",
        analysisProcessingStartedAt: staleStartedAt,
      },
    ]);
    const resetQueryBuilder = createUpdateQueryBuilder(1);
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({ find }),
      createQueryBuilder: jest.fn().mockReturnValue(resetQueryBuilder),
    } as unknown as DataSource;
    const scheduler = new AnalyzerRecoveryScheduler(
      dataSource,
      { enqueueRecoveredAnalyzeTurn } as unknown as AnalyzerQueueService,
      new ConfigService({ ANALYZER_PROCESSING_STALE_MS: 600_000 }),
      { addInterval } as unknown as SchedulerRegistry,
    );

    await scheduler.recover();

    expect(resetQueryBuilder.set).toHaveBeenCalledWith({
      analysisStatus: DebateTurnAnalysisStatus.PENDING,
      analysisProcessingStartedAt: null,
    });
    expect(enqueueRecoveredAnalyzeTurn).toHaveBeenCalledWith("turn-1");
  });

  it("restores stale PROCESSING state when re-enqueueing fails", async () => {
    find.mockResolvedValue([
      {
        id: "turn-1",
        analysisProcessingStartedAt: staleStartedAt,
      },
    ]);
    enqueueRecoveredAnalyzeTurn.mockRejectedValue(new Error("Redis down"));
    const resetQueryBuilder = createUpdateQueryBuilder(1);
    const restoreQueryBuilder = createUpdateQueryBuilder(1);
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({ find }),
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(resetQueryBuilder)
        .mockReturnValueOnce(restoreQueryBuilder),
    } as unknown as DataSource;
    const scheduler = new AnalyzerRecoveryScheduler(
      dataSource,
      { enqueueRecoveredAnalyzeTurn } as unknown as AnalyzerQueueService,
      new ConfigService(),
      { addInterval } as unknown as SchedulerRegistry,
    );

    await scheduler.recover();

    expect(restoreQueryBuilder.set).toHaveBeenCalledWith({
      analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
      analysisProcessingStartedAt: staleStartedAt,
    });
  });
});
