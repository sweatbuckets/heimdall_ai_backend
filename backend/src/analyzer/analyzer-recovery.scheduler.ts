import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { DataSource, LessThan } from "typeorm";
import { DebateTurnAnalysisStatus } from "../debates/domain/debate.enums";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { AnalyzerQueueService } from "./queues/analyzer-queue.service";

const ANALYZER_RECOVERY_INTERVAL_NAME = "analyzer-recovery";
const DEFAULT_ANALYZER_RECOVERY_INTERVAL_MS = 60_000;
const DEFAULT_ANALYZER_PROCESSING_STALE_MS = 10 * 60_000;
const ANALYZER_RECOVERY_BATCH_SIZE = 100;

@Injectable()
export class AnalyzerRecoveryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AnalyzerRecoveryScheduler.name);
  private recoveryRunning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly analyzerQueueService: AnalyzerQueueService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = this.configService.get<number>(
      "ANALYZER_RECOVERY_INTERVAL_MS",
      DEFAULT_ANALYZER_RECOVERY_INTERVAL_MS,
    );
    const interval = setInterval(() => {
      void this.recover();
    }, intervalMs);

    this.schedulerRegistry.addInterval(
      ANALYZER_RECOVERY_INTERVAL_NAME,
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
        "ANALYZER_PROCESSING_STALE_MS",
        DEFAULT_ANALYZER_PROCESSING_STALE_MS,
      );
      const staleBefore = new Date(Date.now() - staleMs);
      const staleTurns = await this.dataSource
        .getRepository(DebateTurnEntity)
        .find({
          select: { id: true, analysisProcessingStartedAt: true },
          where: {
            analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
            analysisProcessingStartedAt: LessThan(staleBefore),
          },
          order: { analysisProcessingStartedAt: "ASC" },
          take: ANALYZER_RECOVERY_BATCH_SIZE,
        });

      let recoveredCount = 0;

      for (const turn of staleTurns) {
        const resetResult = await this.dataSource
          .createQueryBuilder()
          .update(DebateTurnEntity)
          .set({
            analysisStatus: DebateTurnAnalysisStatus.PENDING,
            analysisProcessingStartedAt: null,
          })
          .where("id = :turnId", { turnId: turn.id })
          .andWhere("analysis_status = :status", {
            status: DebateTurnAnalysisStatus.PROCESSING,
          })
          .andWhere("analysis_processing_started_at < :staleBefore", {
            staleBefore,
          })
          .execute();

        if (resetResult.affected !== 1) {
          continue;
        }

        try {
          await this.analyzerQueueService.enqueueRecoveredAnalyzeTurn(turn.id);
          recoveredCount += 1;
        } catch (error) {
          await this.restoreForNextRecovery(
            turn.id,
            turn.analysisProcessingStartedAt ?? staleBefore,
          );
          this.logger.error(
            `Analyzer recovery enqueue failed. turnId=${turn.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      if (recoveredCount > 0) {
        this.logger.log(
          `Analyzer recovery completed. recovered=${recoveredCount}`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Analyzer recovery failed.",
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.recoveryRunning = false;
    }
  }

  private async restoreForNextRecovery(
    turnId: string,
    processingStartedAt: Date,
  ): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(DebateTurnEntity)
      .set({
        analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
        analysisProcessingStartedAt: processingStartedAt,
      })
      .where("id = :turnId", { turnId })
      .andWhere("analysis_status = :status", {
        status: DebateTurnAnalysisStatus.PENDING,
      })
      .execute();
  }
}
