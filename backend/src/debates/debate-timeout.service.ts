import { InjectQueue } from "@nestjs/bullmq";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { DataSource, In } from "typeorm";
import { AiInvocationCancellationService } from "../ai/ai-invocation-cancellation.service";
import { AnalyzerQueueService } from "../analyzer/queues/analyzer-queue.service";
import { CommunityStatus } from "../community-chat/domain/community-chat.enums";
import { CommunityEntity } from "../community-chat/entities/community.entity";
import { DebateChatService } from "../debate-chat/debate-chat.service";
import { DebateChatWebSocketServer } from "../debate-chat/debate-chat.websocket-server";
import {
  FACT_CHECK_GROUNDING_QUEUE,
  FACT_CHECK_SYNTHESIS_QUEUE,
} from "../fact-check/queues/fact-check.constants";
import {
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchStatus,
  FactCheckStage,
  FactCheckStageTaskStatus,
  JudgeTaskStatus,
} from "./domain/debate.enums";
import { DebateEntity } from "./entities/debate.entity";
import { DebateTurnEntity } from "./entities/debate-turn.entity";
import { FactCheckBatchEntity } from "./entities/fact-check-batch.entity";
import { FactCheckStageTaskEntity } from "./entities/fact-check-stage-task.entity";
import { JudgeTaskEntity } from "./entities/judge-task.entity";
import { JudgeQueueService } from "../judge/judge-queue.service";
import {
  DEBATE_DURATION_PER_ROUND_MS,
  DEBATE_FIXED_DURATION_MS,
  isDebateLiveExpired,
} from "./debate-timeout.constants";
import { MemberEntity } from "../members/entities/member.entity";
import { DEBATE_WIN_SCORE_REWARD } from "../members/member-score.constants";
import { CommunityNotificationService } from "../community-chat/community-notification.service";

const TIMEOUT_POLL_INTERVAL_MS = 30_000;
const TIMEOUT_BATCH_SIZE = 20;
const TIMEOUT_ELIGIBLE_STATUSES = [
  DebateStatus.IN_PROGRESS,
  DebateStatus.DEBATE_FINALIZED,
  DebateStatus.JUDGING,
];

interface TerminateDebateOptions {
  allowedStatuses: DebateStatus[];
  eventReason: "TOTAL_TIME_EXPIRED" | "FORFEITED";
  taskFailureReason: string;
  requireExpired: boolean;
  forfeitingMemberId?: string;
}

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
    private readonly communityNotificationService: CommunityNotificationService,
    @InjectQueue(FACT_CHECK_GROUNDING_QUEUE)
    private readonly factCheckGroundingQueue: Queue,
    @InjectQueue(FACT_CHECK_SYNTHESIS_QUEUE)
    private readonly factCheckSynthesisQueue: Queue,
    private readonly judgeQueueService: JudgeQueueService,
  ) {}

  @Interval(TIMEOUT_POLL_INTERVAL_MS)
  async expireOverdueDebates(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const candidates = await this.dataSource
        .getRepository(DebateEntity)
        .createQueryBuilder("debate")
        .where("debate.status IN (:...statuses)", {
          statuses: TIMEOUT_ELIGIBLE_STATUSES,
        })
        .andWhere("debate.started_at IS NOT NULL")
        .andWhere(
          `debate.started_at +
            (:fixedDurationMs +
              debate.rebuttal_question_rounds * :durationPerRoundMs) *
              INTERVAL '1 millisecond' <= :now`,
          {
            fixedDurationMs: DEBATE_FIXED_DURATION_MS,
            durationPerRoundMs: DEBATE_DURATION_PER_ROUND_MS,
            now: new Date(),
          },
        )
        .orderBy("debate.started_at", "ASC")
        .take(TIMEOUT_BATCH_SIZE)
        .getMany();

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
    return this.terminateDebate(debateId, {
      allowedStatuses: TIMEOUT_ELIGIBLE_STATUSES,
      eventReason: "TOTAL_TIME_EXPIRED",
      taskFailureReason: "Debate total time limit expired.",
      requireExpired: true,
    });
  }

  async forfeitDebate(debateId: string, memberId: string): Promise<void> {
    const terminated = await this.terminateDebate(debateId, {
      allowedStatuses: [DebateStatus.IN_PROGRESS],
      eventReason: "FORFEITED",
      taskFailureReason: "Debate was forfeited.",
      requireExpired: false,
      forfeitingMemberId: memberId,
    });
    if (!terminated) {
      throw new ConflictException(
        "Only an in-progress debate can be forfeited.",
      );
    }
  }

  private async terminateDebate(
    debateId: string,
    options: TerminateDebateOptions,
  ): Promise<boolean> {
    const claimed = await this.dataSource.transaction(async (manager) => {
      const debate = await manager.findOne(DebateEntity, {
        where: { id: debateId },
        lock: { mode: "pessimistic_write" },
      });

      if (!debate) {
        if (options.forfeitingMemberId) {
          throw new NotFoundException(`Debate not found: ${debateId}.`);
        }
        return null;
      }

      if (
        options.forfeitingMemberId &&
        debate.sideASpeakerId !== options.forfeitingMemberId &&
        debate.sideBSpeakerId !== options.forfeitingMemberId
      ) {
        throw new ForbiddenException("Only a debate participant can forfeit.");
      }

      if (
        !options.allowedStatuses.includes(debate.status) ||
        (options.requireExpired && !isDebateLiveExpired(debate))
      ) {
        return null;
      }

      const turns = await manager.find(DebateTurnEntity, {
        where: { debateId },
        select: { id: true },
      });
      const turnIds = turns.map((turn) => turn.id);
      const batches = await manager.find(FactCheckBatchEntity, {
        where: { debateId },
        select: { id: true },
      });
      const batchIds = batches.map((batch) => batch.id);
      const tasks =
        batchIds.length === 0
          ? []
          : await manager.find(FactCheckStageTaskEntity, {
              where: { factCheckBatchId: In(batchIds) },
              select: { id: true, stage: true },
            });
      const judgeTasks = await manager.find(JudgeTaskEntity, {
        where: { debateId },
        select: { id: true },
      });
      const endedAt = new Date();

      await manager.update(
        DebateEntity,
        {
          id: debateId,
          status: In(options.allowedStatuses),
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
      if (batchIds.length > 0) {
        await manager.update(
          FactCheckStageTaskEntity,
          {
            factCheckBatchId: In(batchIds),
            status: In([
              FactCheckStageTaskStatus.PENDING,
              FactCheckStageTaskStatus.PROCESSING,
            ]),
          },
          {
            status: FactCheckStageTaskStatus.FAILED,
            processingStartedAt: null,
            failureReason: options.taskFailureReason,
          },
        );
        await manager.update(
          FactCheckBatchEntity,
          {
            id: In(batchIds),
            status: In([
              FactCheckBatchStatus.PENDING,
              FactCheckBatchStatus.PROCESSING,
            ]),
          },
          {
            status: FactCheckBatchStatus.FAILED,
            failureReason: options.taskFailureReason,
          },
        );
      }
      await manager.update(
        JudgeTaskEntity,
        {
          debateId,
          status: In([JudgeTaskStatus.PENDING, JudgeTaskStatus.PROCESSING]),
        },
        {
          status: JudgeTaskStatus.FAILED,
          processingStartedAt: null,
          failureReason: options.taskFailureReason,
        },
      );
      await manager.update(
        CommunityEntity,
        { id: debate.communityId },
        { status: CommunityStatus.WAITING },
      );
      if (options.forfeitingMemberId) {
        const forfeitingMember = await manager.findOne(MemberEntity, {
          where: { id: options.forfeitingMemberId },
          select: { displayName: true },
        });
        if (!forfeitingMember) {
          throw new Error(
            `Forfeiting member not found: ${options.forfeitingMemberId}.`,
          );
        }
        const winnerMemberId =
          debate.sideASpeakerId === options.forfeitingMemberId
            ? debate.sideBSpeakerId
            : debate.sideASpeakerId;
        const scoreResult = await manager.increment(
          MemberEntity,
          { id: winnerMemberId },
          "score",
          DEBATE_WIN_SCORE_REWARD,
        );
        if (scoreResult.affected !== 1) {
          throw new Error(
            `Forfeit winner score update failed: ${winnerMemberId}.`,
          );
        }
        const notification =
          await this.communityNotificationService.createDebateForfeit(
            manager,
            debate.communityId,
            debateId,
            forfeitingMember.displayName,
          );
        return {
          communityId: debate.communityId,
          turnIds,
          tasks,
          judgeTaskIds: judgeTasks.map((task) => task.id),
          notification,
        };
      }

      const notification =
        await this.communityNotificationService.createDebateTimeout(
          manager,
          debate.communityId,
          debateId,
        );
      return {
        communityId: debate.communityId,
        turnIds,
        tasks,
        judgeTaskIds: judgeTasks.map((task) => task.id),
        notification,
      };
    });

    if (!claimed) return false;

    this.cancellationService.cancelDebate(debateId);
    await Promise.allSettled([
      ...claimed.turnIds.map((turnId) =>
        this.analyzerQueueService.cancelAnalyzeTurn(turnId),
      ),
      ...claimed.tasks.map((task) => this.removeFactCheckJob(task)),
      ...claimed.judgeTaskIds.map((taskId) =>
        this.judgeQueueService.removeTaskJob(taskId),
      ),
      this.debateChatService.clearDebateDrafts(debateId),
    ]);
    this.websocketServer.publishDebateEnded(
      claimed.communityId,
      debateId,
      DebateStatus.FAILED,
      options.eventReason,
    );
    if (claimed.notification) {
      this.communityNotificationService.publish(claimed.notification);
    }
    return true;
  }

  private async removeFactCheckJob(task: {
    id: string;
    stage: FactCheckStage;
  }): Promise<void> {
    const queue =
      task.stage === FactCheckStage.GROUNDING
        ? this.factCheckGroundingQueue
        : this.factCheckSynthesisQueue;
    const job = await queue.getJob(task.id);
    if (!job) return;
    const state = await job.getState();
    if (state !== "active" && state !== "completed") {
      await job.remove();
    }
  }
}
