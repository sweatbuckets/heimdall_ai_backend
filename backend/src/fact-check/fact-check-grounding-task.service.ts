import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { DataSource, In } from "typeorm";
import {
  AiInvocationCancellationService,
  AiInvocationCancelledError,
} from "../ai/ai-invocation-cancellation.service";
import {
  DebateStatus,
  FactCheckBatchStatus,
  FactCheckStage,
  FactCheckStageTaskStatus,
} from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { FactCheckBatchEntity } from "../debates/entities/fact-check-batch.entity";
import { FactCheckGroundingSnapshotEntity } from "../debates/entities/fact-check-grounding-snapshot.entity";
import { FactCheckStageTaskEntity } from "../debates/entities/fact-check-stage-task.entity";
import {
  FactCheckConflictError,
  NonRetryableFactCheckError,
} from "./errors/fact-check.errors";
import { FactCheckInputAssembler } from "./fact-check-input.assembler";
import { FactCheckQueueService } from "./fact-check-queue.service";
import {
  isFinalFactCheckAttempt,
  toFactCheckErrorCode,
  toFactCheckFailureReason,
} from "./fact-check-task-state.util";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { DEFAULT_MAX_FACT_CHECK_TARGETS_PER_BATCH } from "./constants";
import { FactCheckStageJobData } from "./queues/fact-check.constants";
import { validateFactCheckBatchInput } from "./validators/fact-check-batch-input.validator";

@Injectable()
export class FactCheckGroundingTaskService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inputAssembler: FactCheckInputAssembler,
    private readonly aiService: FactCheckerAiService,
    private readonly queueService: FactCheckQueueService,
    private readonly configService: ConfigService,
    private readonly cancellationService: AiInvocationCancellationService,
  ) {}

  async process(
    taskId: string,
    job?: Job<FactCheckStageJobData>,
  ): Promise<void> {
    if (!(await this.claimTask(taskId))) {
      await this.handleUnclaimedTask(taskId);
      return;
    }

    try {
      const input = await this.inputAssembler.assembleForTask(
        taskId,
        FactCheckStage.GROUNDING,
      );
      validateFactCheckBatchInput(input, {
        maxTargetsPerBatch: this.configService.get<number>(
          "FACT_CHECK_MAX_TARGETS_PER_BATCH",
          DEFAULT_MAX_FACT_CHECK_TARGETS_PER_BATCH,
        ),
      });

      const groundedEvidence = await this.cancellationService.run(
        input.debate.id,
        (signal) => this.aiService.ground(input, signal),
      );
      const synthesisTaskId = await this.completeGrounding(
        taskId,
        groundedEvidence,
      );
      await this.queueService.enqueueSynthesisTask(synthesisTaskId);
    } catch (error) {
      await this.handleFailure(taskId, job, error);
      if (
        error instanceof NonRetryableFactCheckError ||
        error instanceof AiInvocationCancelledError
      ) {
        return;
      }
      throw error;
    }
  }

  private async claimTask(taskId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(FactCheckStageTaskEntity, {
        where: {
          id: taskId,
          stage: FactCheckStage.GROUNDING,
          status: FactCheckStageTaskStatus.PENDING,
        },
        lock: { mode: "pessimistic_write" },
      });
      if (!task) return false;

      await manager.update(
        FactCheckStageTaskEntity,
        { id: taskId, status: FactCheckStageTaskStatus.PENDING },
        {
          status: FactCheckStageTaskStatus.PROCESSING,
          processingStartedAt: new Date(),
          attemptCount: () => '"attempt_count" + 1',
          lastErrorCode: null,
          failureReason: null,
        },
      );

      // Batch status represents the whole fact-check pipeline. Mark it as
      // processing as soon as the first (grounding) stage is claimed.
      await manager.update(
        FactCheckBatchEntity,
        { id: task.factCheckBatchId, status: FactCheckBatchStatus.PENDING },
        { status: FactCheckBatchStatus.PROCESSING, failureReason: null },
      );
      return true;
    });
  }

  private async handleUnclaimedTask(taskId: string): Promise<void> {
    const task = await this.dataSource
      .getRepository(FactCheckStageTaskEntity)
      .findOne({ where: { id: taskId } });
    if (!task) {
      throw new NonRetryableFactCheckError(
        `FactCheckStageTask not found: ${taskId}.`,
      );
    }
    if (task.stage !== FactCheckStage.GROUNDING) {
      throw new NonRetryableFactCheckError(
        `FactCheckStageTask is not GROUNDING: ${taskId}.`,
      );
    }

    if (task.status === FactCheckStageTaskStatus.COMPLETED) {
      const synthesisTask = await this.dataSource
        .getRepository(FactCheckStageTaskEntity)
        .findOne({
          where: {
            factCheckBatchId: task.factCheckBatchId,
            stage: FactCheckStage.SYNTHESIS,
            status: FactCheckStageTaskStatus.PENDING,
          },
        });
      if (synthesisTask) {
        await this.queueService.enqueueSynthesisTask(synthesisTask.id);
      }
    }
  }

  private async completeGrounding(
    taskId: string,
    groundedEvidence: {
      evidenceText: string;
      webSearchQueries: string[];
      sources: Array<{
        sourceIndex: number;
        title: string;
        publisher: string;
        url: string;
      }>;
    },
  ): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(FactCheckStageTaskEntity, {
        where: { id: taskId },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !task ||
        task.stage !== FactCheckStage.GROUNDING ||
        task.status !== FactCheckStageTaskStatus.PROCESSING
      ) {
        throw new FactCheckConflictError(
          `Grounding task completion state changed: ${taskId}.`,
        );
      }

      const batch = await manager.findOne(FactCheckBatchEntity, {
        where: { id: task.factCheckBatchId },
      });
      const debate = batch
        ? await manager.findOne(DebateEntity, { where: { id: batch.debateId } })
        : null;
      if (!batch || !debate || debate.status === DebateStatus.FAILED) {
        throw new AiInvocationCancelledError(batch?.debateId ?? "unknown");
      }

      await manager.insert(FactCheckGroundingSnapshotEntity, {
        id: randomUUID(),
        factCheckBatchId: batch.id,
        evidenceText: groundedEvidence.evidenceText,
        webSearchQueries: groundedEvidence.webSearchQueries,
        sources: groundedEvidence.sources,
      });

      const completedAt = new Date();
      const completed = await manager.update(
        FactCheckStageTaskEntity,
        {
          id: taskId,
          status: FactCheckStageTaskStatus.PROCESSING,
        },
        {
          status: FactCheckStageTaskStatus.COMPLETED,
          processingStartedAt: null,
          completedAt,
        },
      );
      if (completed.affected !== 1) {
        throw new FactCheckConflictError(
          `Grounding task completion state changed: ${taskId}.`,
        );
      }

      const synthesisTaskId = randomUUID();
      await manager.insert(FactCheckStageTaskEntity, {
        id: synthesisTaskId,
        factCheckBatchId: batch.id,
        stage: FactCheckStage.SYNTHESIS,
        status: FactCheckStageTaskStatus.PENDING,
        attemptCount: 0,
      });
      return synthesisTaskId;
    });
  }

  private async handleFailure(
    taskId: string,
    job: Job<FactCheckStageJobData> | undefined,
    error: unknown,
  ): Promise<void> {
    const finalFailure =
      error instanceof NonRetryableFactCheckError ||
      error instanceof AiInvocationCancelledError ||
      isFinalFactCheckAttempt(job);
    const status = finalFailure
      ? FactCheckStageTaskStatus.FAILED
      : FactCheckStageTaskStatus.PENDING;

    await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(FactCheckStageTaskEntity, {
        where: { id: taskId },
      });
      if (!task) return;
      await manager.update(
        FactCheckStageTaskEntity,
        { id: taskId, status: FactCheckStageTaskStatus.PROCESSING },
        {
          status,
          processingStartedAt: null,
          lastErrorCode: toFactCheckErrorCode(error),
          failureReason: toFactCheckFailureReason(error),
        },
      );
      if (finalFailure) {
        await manager.update(
          FactCheckBatchEntity,
          {
            id: task.factCheckBatchId,
            status: In([
              FactCheckBatchStatus.PENDING,
              FactCheckBatchStatus.PROCESSING,
            ]),
          },
          {
            status: FactCheckBatchStatus.FAILED,
            failureReason: toFactCheckFailureReason(error),
          },
        );
      }
    });
  }
}
