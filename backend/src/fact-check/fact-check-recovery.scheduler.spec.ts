import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { FactCheckBatchTaskService } from "./fact-check-batch-task.service";
import { FactCheckRecoveryScheduler } from "./fact-check-recovery.scheduler";

describe("FactCheckRecoveryScheduler", () => {
  const resetStaleProcessingTasks = jest.fn();
  const enqueuePendingTasks = jest.fn();
  const addInterval = jest.fn();

  const taskService = {
    resetStaleProcessingTasks,
    enqueuePendingTasks,
  } as unknown as FactCheckBatchTaskService;
  const schedulerRegistry = {
    addInterval,
  } as unknown as SchedulerRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    resetStaleProcessingTasks.mockResolvedValue(0);
    enqueuePendingTasks.mockResolvedValue(0);
  });

  it("registers the recovery interval on application bootstrap", () => {
    const configService = new ConfigService({
      FACT_CHECK_RECOVERY_INTERVAL_MS: 30_000,
    });
    const scheduler = new FactCheckRecoveryScheduler(
      taskService,
      configService,
      schedulerRegistry,
    );

    scheduler.onApplicationBootstrap();

    expect(addInterval).toHaveBeenCalledWith(
      "fact-check-recovery",
      expect.anything(),
    );
    clearInterval(addInterval.mock.calls[0][1] as NodeJS.Timeout);
  });

  it("resets stale tasks before enqueueing pending tasks", async () => {
    const configService = new ConfigService({
      FACT_CHECK_PROCESSING_STALE_MS: 600_000,
    });
    const scheduler = new FactCheckRecoveryScheduler(
      taskService,
      configService,
      schedulerRegistry,
    );
    const before = Date.now();

    await scheduler.recover();

    const staleBefore = resetStaleProcessingTasks.mock.calls[0][0] as Date;
    expect(staleBefore.getTime()).toBeGreaterThanOrEqual(before - 600_000);
    expect(staleBefore.getTime()).toBeLessThanOrEqual(Date.now() - 600_000);
    expect(enqueuePendingTasks).toHaveBeenCalledTimes(1);
    expect(resetStaleProcessingTasks.mock.invocationCallOrder[0]).toBeLessThan(
      enqueuePendingTasks.mock.invocationCallOrder[0],
    );
  });

  it("does not overlap recovery runs", async () => {
    let finishReset: ((value: number) => void) | undefined;
    resetStaleProcessingTasks.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finishReset = resolve;
        }),
    );
    const scheduler = new FactCheckRecoveryScheduler(
      taskService,
      new ConfigService(),
      schedulerRegistry,
    );

    const firstRun = scheduler.recover();
    await scheduler.recover();

    expect(resetStaleProcessingTasks).toHaveBeenCalledTimes(1);
    finishReset?.(0);
    await firstRun;
  });
});
