import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { DebateStatus } from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { DataSource } from "typeorm";
import {
  JUDGE_RECOVERY_BATCH_SIZE,
  DEFAULT_JUDGE_RECOVERY_INTERVAL_MS,
  DEFAULT_JUDGE_PROCESSING_STALE_MS,
} from "./constants";
import { JudgeQueueService } from "./judge-queue.service";
import { JudgeReadinessService } from "./judge-readiness.service";

const JUDGE_RECOVERY_INTERVAL_NAME = "judge-recovery";

@Injectable()
export class JudgeRecoveryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JudgeRecoveryScheduler.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly readinessService: JudgeReadinessService,
    private readonly queueService: JudgeQueueService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = this.configService.get<number>(
      "JUDGE_RECOVERY_INTERVAL_MS",
      DEFAULT_JUDGE_RECOVERY_INTERVAL_MS,
    );
    const interval = setInterval(() => {
      void this.recover();
    }, intervalMs);
    this.schedulerRegistry.addInterval(JUDGE_RECOVERY_INTERVAL_NAME, interval);
  }

  async recover(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const staleMs = this.configService.get<number>(
        "JUDGE_PROCESSING_STALE_MS",
        DEFAULT_JUDGE_PROCESSING_STALE_MS,
      );
      const reset = await this.queueService.resetStaleProcessingTasks(
        new Date(Date.now() - staleMs),
      );
      const debates = await this.dataSource.getRepository(DebateEntity).find({
        where: { status: DebateStatus.DEBATE_FINALIZED },
        order: { endedAt: "ASC" },
        take: JUDGE_RECOVERY_BATCH_SIZE,
        select: { id: true },
      });
      for (const debate of debates) {
        await this.readinessService.tryStartJudge(debate.id);
      }
      const pending = await this.queueService.enqueuePendingTasks();
      if (reset > 0 || debates.length > 0 || pending > 0) {
        this.logger.log(
          `Judge recovery completed. reset=${reset} finalized=${debates.length} pending=${pending}`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Judge recovery failed.",
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
