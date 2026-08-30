import { DataSource } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { JudgeQueueService } from "./judge-queue.service";
import { JudgeReadinessService } from "./judge-readiness.service";
import { JudgeRecoveryScheduler } from "./judge-recovery.scheduler";

describe("JudgeRecoveryScheduler", () => {
  it("polls at the configured recovery interval", () => {
    jest.useFakeTimers();
    const schedulerRegistry = { addInterval: jest.fn() };
    const scheduler = new JudgeRecoveryScheduler(
      {} as DataSource,
      {} as JudgeReadinessService,
      {} as JudgeQueueService,
      new ConfigService({ JUDGE_RECOVERY_INTERVAL_MS: 10_000 }),
      schedulerRegistry as unknown as SchedulerRegistry,
    );
    const recover = jest.spyOn(scheduler, "recover").mockResolvedValue();

    scheduler.onApplicationBootstrap();
    jest.advanceTimersByTime(9_999);
    expect(recover).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      "judge-recovery",
      expect.anything(),
    );
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("discovers finalized debates and enqueues persisted pending tasks", async () => {
    const dataSource = {
      getRepository: () => ({
        find: jest
          .fn()
          .mockResolvedValue([{ id: "debate-1" }, { id: "debate-2" }]),
      }),
    };
    const readinessService = {
      tryStartJudge: jest.fn().mockResolvedValue(undefined),
    };
    const queueService = {
      enqueuePendingTasks: jest.fn().mockResolvedValue(2),
      resetStaleProcessingTasks: jest.fn().mockResolvedValue(1),
    };
    const scheduler = new JudgeRecoveryScheduler(
      dataSource as unknown as DataSource,
      readinessService as unknown as JudgeReadinessService,
      queueService as unknown as JudgeQueueService,
      new ConfigService({ JUDGE_PROCESSING_STALE_MS: 120_000 }),
      { addInterval: jest.fn() } as unknown as SchedulerRegistry,
    );

    await scheduler.recover();

    expect(readinessService.tryStartJudge).toHaveBeenNthCalledWith(
      1,
      "debate-1",
    );
    expect(readinessService.tryStartJudge).toHaveBeenNthCalledWith(
      2,
      "debate-2",
    );
    expect(queueService.enqueuePendingTasks).toHaveBeenCalledTimes(1);
    expect(queueService.resetStaleProcessingTasks).toHaveBeenCalledWith(
      expect.any(Date),
    );
  });
});
