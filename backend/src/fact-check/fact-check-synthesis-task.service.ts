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
import { FactCheckResultEntity } from "../debates/entities/fact-check-result.entity";
import { FactCheckSourceEntity } from "../debates/entities/fact-check-source.entity";
import { FactCheckStageTaskEntity } from "../debates/entities/fact-check-stage-task.entity";
import {
  DEFAULT_MAX_FACT_CHECK_REASON_LENGTH,
  DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
  DEFAULT_MAX_FACT_CHECK_TARGETS_PER_BATCH,
} from "./constants";
import {
  FactCheckConflictError,
  NonRetryableFactCheckError,
} from "./errors/fact-check.errors";
import { FactCheckInputAssembler } from "./fact-check-input.assembler";
import { FactCheckBatchOutput } from "./dto/fact-check-batch.dto";
import {
  isFinalFactCheckAttempt,
  toFactCheckErrorCode,
  toFactCheckFailureReason,
} from "./fact-check-task-state.util";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { mapFactCheckBatchOutputToEntities } from "./mappers/fact-check-result.mapper";
import { FactCheckStageJobData } from "./queues/fact-check.constants";
import { validateFactCheckBatchInput } from "./validators/fact-check-batch-input.validator";
import { validateFactCheckBatchOutput } from "./validators/fact-check-batch-output.validator";

@Injectable()
export class FactCheckSynthesisTaskService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inputAssembler: FactCheckInputAssembler,
    private readonly aiService: FactCheckerAiService,
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
      const { input, groundedEvidence } =
        await this.inputAssembler.assembleSynthesisForTask(taskId);
      validateFactCheckBatchInput(input, {
        maxTargetsPerBatch: this.configService.get<number>(
          "FACT_CHECK_MAX_TARGETS_PER_BATCH",
          DEFAULT_MAX_FACT_CHECK_TARGETS_PER_BATCH,
        ),
      });
      const output = await this.cancellationService.run(
        input.debate.id,
        (signal) => this.aiService.synthesize(input, groundedEvidence, signal),
      );
      const maxSourcesPerResult = this.configService.get<number>(
        "FACT_CHECK_MAX_SOURCES_PER_RESULT",
        DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
      );
      const normalizedOutput = trimFactCheckSources(
        output,
        maxSourcesPerResult,
      );
      validateFactCheckBatchOutput(input, normalizedOutput, groundedEvidence, {
        maxReasonLength: this.configService.get<number>(
          "FACT_CHECK_MAX_REASON_LENGTH",
          DEFAULT_MAX_FACT_CHECK_REASON_LENGTH,
        ),
        maxSourcesPerResult,
      });

      const task = await this.dataSource
        .getRepository(FactCheckStageTaskEntity)
        .findOne({ where: { id: taskId } });
      if (!task) {
        throw new NonRetryableFactCheckError(
          `FactCheckStageTask not found: ${taskId}.`,
        );
      }
      const entities = mapFactCheckBatchOutputToEntities(
        task.factCheckBatchId,
        normalizedOutput,
        groundedEvidence,
        new Date(),
      );
      await this.completeSynthesis(taskId, entities);
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
    const result = await this.dataSource
      .createQueryBuilder()
      .update(FactCheckStageTaskEntity)
      .set({
        status: FactCheckStageTaskStatus.PROCESSING,
        processingStartedAt: new Date(),
        attemptCount: () => '"attempt_count" + 1',
        lastErrorCode: null,
        failureReason: null,
      })
      .where("id = :taskId", { taskId })
      .andWhere("stage = :stage", { stage: FactCheckStage.SYNTHESIS })
      .andWhere("status = :status", {
        status: FactCheckStageTaskStatus.PENDING,
      })
      .execute();
    return result.affected === 1;
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
    if (task.stage !== FactCheckStage.SYNTHESIS) {
      throw new NonRetryableFactCheckError(
        `FactCheckStageTask is not SYNTHESIS: ${taskId}.`,
      );
    }
  }

  private async completeSynthesis(
    taskId: string,
    entities: {
      results: Array<Partial<FactCheckResultEntity>>;
      sources: Array<Partial<FactCheckSourceEntity>>;
    },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(FactCheckStageTaskEntity, {
        where: { id: taskId },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !task ||
        task.stage !== FactCheckStage.SYNTHESIS ||
        task.status !== FactCheckStageTaskStatus.PROCESSING
      ) {
        throw new FactCheckConflictError(
          `Synthesis task completion state changed: ${taskId}.`,
        );
      }
      const batch = await manager.findOne(FactCheckBatchEntity, {
        where: { id: task.factCheckBatchId },
        lock: { mode: "pessimistic_write" },
      });
      const debate = batch
        ? await manager.findOne(DebateEntity, { where: { id: batch.debateId } })
        : null;
      if (!batch || !debate || debate.status === DebateStatus.FAILED) {
        throw new AiInvocationCancelledError(batch?.debateId ?? "unknown");
      }
      if (batch.status !== FactCheckBatchStatus.PROCESSING) {
        if (batch.status === FactCheckBatchStatus.COMPLETED) {
          await manager.update(
            FactCheckStageTaskEntity,
            { id: taskId, status: FactCheckStageTaskStatus.PROCESSING },
            {
              status: FactCheckStageTaskStatus.COMPLETED,
              processingStartedAt: null,
              completedAt: new Date(),
            },
          );
          return;
        }
        throw new AiInvocationCancelledError(batch.debateId);
      }

      if (entities.results.length) {
        await manager.insert(FactCheckResultEntity, entities.results);
      }
      if (entities.sources.length) {
        await manager.insert(FactCheckSourceEntity, entities.sources);
      }

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
          `Synthesis task completion state changed: ${taskId}.`,
        );
      }
      const batchCompleted = await manager.update(
        FactCheckBatchEntity,
        {
          id: batch.id,
          status: FactCheckBatchStatus.PROCESSING,
        },
        {
          status: FactCheckBatchStatus.COMPLETED,
          completedAt,
          failureReason: null,
        },
      );
      if (batchCompleted.affected !== 1) {
        throw new FactCheckConflictError(
          `FactCheckBatch completion state changed: ${batch.id}.`,
        );
      }
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

function trimFactCheckSources(
  output: FactCheckBatchOutput,
  maxSourcesPerResult: number,
): FactCheckBatchOutput {
  return {
    ...output,
    results: output.results.map((result) => ({
      ...result,
      sourceIndexes: Array.isArray(result.sourceIndexes)
        ? [...new Set(result.sourceIndexes)].slice(0, maxSourcesPerResult)
        : result.sourceIndexes,
    })),
  };
}
