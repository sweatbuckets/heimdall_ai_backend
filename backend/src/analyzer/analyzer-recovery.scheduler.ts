import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { DataSource, LessThan } from "typeorm";
import { DebateTurnAnalysisStatus } from "../debates/domain/debate.enums";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { AnalyzerQueueService } from "./queues/analyzer-queue.service";

const ANALYZER_RECOVERY_INTERVAL_NAME = "analyzer-recovery";
const DEFAULT_ANALYZER_RECOVERY_INTERVAL_MS = 30_000;
const DEFAULT_ANALYZER_PROCESSING_STALE_MS = 75_000;
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
      const pendingTurns = await this.dataSource
        .getRepository(DebateTurnEntity)
        .find({
          select: {
            id: true,
            debateId: true,
            phase: true,
            round: true,
          },
          where: {
            analysisStatus: DebateTurnAnalysisStatus.PENDING,
          },
          order: { createdAt: "ASC" },
          take: ANALYZER_RECOVERY_BATCH_SIZE,
        });
      let pendingEnqueuedCount = 0;
      const pendingRoundKeys = new Set<string>();

      for (const turn of pendingTurns) {
        const roundKey = `${turn.debateId}-${turn.phase}-${turn.round}`;
        if (pendingRoundKeys.has(roundKey)) continue;
        pendingRoundKeys.add(roundKey);
        try {
          const jobId =
            await this.analyzerQueueService.enqueuePendingAnalyzeTurn(turn.id);
          if (jobId) pendingEnqueuedCount += 1;
        } catch (error) {
          this.logger.error(
            `Pending Analyzer enqueue failed. turnId=${turn.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      const staleMs = this.configService.get<number>(
        "ANALYZER_PROCESSING_STALE_MS",
        DEFAULT_ANALYZER_PROCESSING_STALE_MS,
      );
      const staleBefore = new Date(Date.now() - staleMs);
      const staleTurns = await this.dataSource
        .getRepository(DebateTurnEntity)
        .find({
          select: {
            id: true,
            debateId: true,
            phase: true,
            round: true,
            analysisProcessingStartedAt: true,
          },
          where: {
            analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
            analysisProcessingStartedAt: LessThan(staleBefore),
          },
          order: { analysisProcessingStartedAt: "ASC" },
          take: ANALYZER_RECOVERY_BATCH_SIZE,
        });

      let recoveredCount = 0;
      const staleRoundKeys = new Set<string>();

      for (const turn of staleTurns) {
        const roundKey = `${turn.debateId}-${turn.phase}-${turn.round}`;
        if (staleRoundKeys.has(roundKey)) continue;
        staleRoundKeys.add(roundKey);
        const resetResult = await this.dataSource
          .createQueryBuilder()
          .update(DebateTurnEntity)
          .set({
            analysisStatus: DebateTurnAnalysisStatus.PENDING,
            analysisProcessingStartedAt: null,
          })
          .where("debate_id = :debateId", { debateId: turn.debateId })
          .andWhere("phase = :phase", { phase: turn.phase })
          .andWhere("round = :round", { round: turn.round })
          .andWhere("analysis_status = :status", {
            status: DebateTurnAnalysisStatus.PROCESSING,
          })
          .andWhere("analysis_processing_started_at < :staleBefore", {
            staleBefore,
          })
          .execute();

        if (!resetResult.affected) {
          continue;
        }

        try {
          const jobId =
            await this.analyzerQueueService.enqueueRecoveredAnalyzeTurn(
              turn.id,
            );
          if (jobId) recoveredCount += 1;
        } catch (error) {
          await this.restoreForNextRecovery(
            turn.debateId,
            turn.phase,
            turn.round,
            turn.analysisProcessingStartedAt ?? staleBefore,
          );
          this.logger.error(
            `Analyzer recovery enqueue failed. turnId=${turn.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      if (pendingEnqueuedCount > 0 || recoveredCount > 0) {
        this.logger.log(
          `Analyzer recovery completed. pending=${pendingEnqueuedCount} recovered=${recoveredCount}`,
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
    debateId: string,
    phase: string,
    round: number,
    processingStartedAt: Date,
  ): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(DebateTurnEntity)
      .set({
        analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
        analysisProcessingStartedAt: processingStartedAt,
      })
      .where("debate_id = :debateId", { debateId })
      .andWhere("phase = :phase", { phase })
      .andWhere("round = :round", { round })
      .andWhere("analysis_status = :status", {
        status: DebateTurnAnalysisStatus.PENDING,
      })
      .execute();
  }
}
