import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { FactCheckBatchTaskService } from "./fact-check-batch-task.service";

const FACT_CHECK_RECOVERY_INTERVAL_NAME = "fact-check-recovery";
const DEFAULT_FACT_CHECK_RECOVERY_INTERVAL_MS = 60_000;
const DEFAULT_FACT_CHECK_PROCESSING_STALE_MS = 10 * 60_000;

@Injectable()
export class FactCheckRecoveryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(FactCheckRecoveryScheduler.name);
  private recoveryRunning = false;

  constructor(
    private readonly factCheckBatchTaskService: FactCheckBatchTaskService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = this.configService.get<number>(
      "FACT_CHECK_RECOVERY_INTERVAL_MS",
      DEFAULT_FACT_CHECK_RECOVERY_INTERVAL_MS,
    );
    const interval = setInterval(() => {
      void this.recover();
    }, intervalMs);

    this.schedulerRegistry.addInterval(
      FACT_CHECK_RECOVERY_INTERVAL_NAME,
      interval,
    );
  }

  async recover(): Promise<void> {
    if (this.recoveryRunning) {
      return;
    }

    this.recoveryRunning = true;

    try {
      const staleMs = this.configService.get<number>(
        "FACT_CHECK_PROCESSING_STALE_MS",
        DEFAULT_FACT_CHECK_PROCESSING_STALE_MS,
      );
      const staleBefore = new Date(Date.now() - staleMs);
      const resetCount =
        await this.factCheckBatchTaskService.resetStaleProcessingTasks(
          staleBefore,
        );
      const enqueuedCount =
        await this.factCheckBatchTaskService.enqueuePendingTasks();

      if (resetCount > 0 || enqueuedCount > 0) {
        this.logger.log(
          `Fact check recovery completed. reset=${resetCount} enqueued=${enqueuedCount}`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Fact check recovery failed.",
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.recoveryRunning = false;
    }
  }
}
