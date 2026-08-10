import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { DataSource, In, LessThanOrEqual } from "typeorm";
import { AiInvocationCancellationService } from "../ai/ai-invocation-cancellation.service";
import { AnalyzerQueueService } from "../analyzer/queues/analyzer-queue.service";
import { CommunityStatus } from "../community-chat/domain/community-chat.enums";
import { CommunityEntity } from "../community-chat/entities/community.entity";
import { DebateChatService } from "../debate-chat/debate-chat.service";
import { DebateChatWebSocketServer } from "../debate-chat/debate-chat.websocket-server";
import { FACT_CHECK_QUEUE } from "../fact-check/queues/fact-check.constants";
import {
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchTaskStatus,
} from "./domain/debate.enums";
import { DebateEntity } from "./entities/debate.entity";
import { DebateTurnEntity } from "./entities/debate-turn.entity";
import { FactCheckBatchTaskEntity } from "./entities/fact-check-batch-task.entity";
import { DEBATE_TOTAL_DURATION_MS } from "./debate-timeout.constants";

const TIMEOUT_POLL_INTERVAL_MS = 2_000;
const TIMEOUT_BATCH_SIZE = 20;

@Injectable()
export class DebateTimeoutService {
  private readonly logger = new Logger(DebateTimeoutService.name);
  private polling = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly analyzerQueueService: AnalyzerQueueService,
    private readonly cancellationService: AiInvocationCancellationService,
    private readonly debateChatService: DebateChatService,
    private readonly websocketServer: DebateChatWebSocketServer,
    @InjectQueue(FACT_CHECK_QUEUE)
    private readonly factCheckQueue: Queue,
  ) {}

  @Interval(TIMEOUT_POLL_INTERVAL_MS)
  async expireOverdueDebates(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const deadline = new Date(Date.now() - DEBATE_TOTAL_DURATION_MS);
      const candidates = await this.dataSource
        .getRepository(DebateEntity)
        .find({
          where: {
            status: In([
              DebateStatus.IN_PROGRESS,
              DebateStatus.DEBATE_FINALIZED,
              DebateStatus.JUDGING,
            ]),
            startedAt: LessThanOrEqual(deadline),
          },
          order: { startedAt: "ASC" },
          take: TIMEOUT_BATCH_SIZE,
        });

      for (const candidate of candidates) {
        try {
          await this.expireDebate(candidate.id);
        } catch (error) {
          this.logger.error(
            `Failed to expire debate ${candidate.id}.`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      this.polling = false;
    }
  }

  async expireDebate(debateId: string): Promise<boolean> {
    const claimed = await this.dataSource.transaction(async (manager) => {
      const debate = await manager.findOne(DebateEntity, {
        where: { id: debateId },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !debate ||
        ![
          DebateStatus.IN_PROGRESS,
          DebateStatus.DEBATE_FINALIZED,
          DebateStatus.JUDGING,
        ].includes(debate.status) ||
        !debate.startedAt ||
        Date.now() < debate.startedAt.getTime() + DEBATE_TOTAL_DURATION_MS
      ) {
        return null;
      }

      const turns = await manager.find(DebateTurnEntity, {
        where: { debateId },
        select: { id: true },
      });
      const turnIds = turns.map((turn) => turn.id);
      const tasks =
        turnIds.length === 0
          ? []
          : await manager.find(FactCheckBatchTaskEntity, {
              where: { turnId: In(turnIds) },
              select: { id: true },
            });
      const endedAt = new Date();

      await manager.update(
        DebateEntity,
        {
          id: debateId,
          status: In([
            DebateStatus.IN_PROGRESS,
            DebateStatus.DEBATE_FINALIZED,
            DebateStatus.JUDGING,
          ]),
        },
        {
          status: DebateStatus.FAILED,
          endedAt,
          currentPhase: null,
          currentRound: null,
          currentTurnSide: null,
          currentTurnStartedAt: null,
        },
      );
      await manager.update(
        DebateTurnEntity,
        {
          debateId,
          analysisStatus: In([
            DebateTurnAnalysisStatus.PENDING,
            DebateTurnAnalysisStatus.PROCESSING,
          ]),
        },
        {
          analysisStatus: DebateTurnAnalysisStatus.FAILED,
          analysisProcessingStartedAt: null,
        },
      );
      if (turnIds.length > 0) {
        await manager.update(
          FactCheckBatchTaskEntity,
          {
            turnId: In(turnIds),
            status: In([
              FactCheckBatchTaskStatus.PENDING,
              FactCheckBatchTaskStatus.PROCESSING,
            ]),
          },
          {
            status: FactCheckBatchTaskStatus.FAILED,
            failureReason: "Debate total time limit expired.",
          },
        );
      }
      await manager.update(
        CommunityEntity,
        { id: debate.communityId },
        { status: CommunityStatus.WAITING },
      );

      return {
        communityId: debate.communityId,
        turnIds,
        taskIds: tasks.map((task) => task.id),
      };
    });

    if (!claimed) return false;

    this.cancellationService.cancelDebate(debateId);
    await Promise.allSettled([
      ...claimed.turnIds.map((turnId) =>
        this.analyzerQueueService.cancelAnalyzeTurn(turnId),
      ),
      ...claimed.taskIds.map((taskId) => this.removeFactCheckJob(taskId)),
      this.debateChatService.clearDebateDrafts(debateId),
    ]);
    this.websocketServer.publishDebateEnded(
      claimed.communityId,
      debateId,
      DebateStatus.FAILED,
      "TOTAL_TIME_EXPIRED",
    );
    return true;
  }

  private async removeFactCheckJob(taskId: string): Promise<void> {
    const job = await this.factCheckQueue.getJob(taskId);
    if (!job) return;
    const state = await job.getState();
    if (state !== "active" && state !== "completed") {
      await job.remove();
    }
  }
}
