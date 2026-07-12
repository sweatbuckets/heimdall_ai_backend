import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { DataSource } from "typeorm";
import {
  FACT_CHECK_JOB_ATTEMPTS,
  FACT_CHECK_JOB_BACKOFF_DELAY_MS,
  FACT_CHECK_RECOVERY_BATCH_SIZE,
  DEFAULT_MAX_FACT_CHECK_REASON_LENGTH,
  DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
  DEFAULT_MAX_FACT_CHECK_TARGETS_PER_BATCH,
} from "./constants";
import { FactCheckInputAssembler } from "./fact-check-input.assembler";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { mapFactCheckBatchOutputToEntities } from "./mappers/fact-check-result.mapper";
import {
  FACT_CHECK_BATCH_JOB,
  FACT_CHECK_QUEUE,
  FactCheckJobData,
} from "./queues/fact-check.constants";
import { validateFactCheckBatchInput } from "./validators/fact-check-batch-input.validator";
import { validateFactCheckBatchOutput } from "./validators/fact-check-batch-output.validator";
import {
  NonRetryableFactCheckError,
  FactCheckConflictError,
} from "./errors/fact-check.errors";
import {
  DebateStatus,
  FactCheckBatchTaskStatus,
} from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";
import { FactCheckResultEntity } from "../debates/entities/fact-check-result.entity";
import { FactCheckSourceEntity } from "../debates/entities/fact-check-source.entity";

@Injectable()
export class FactCheckBatchTaskService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inputAssembler: FactCheckInputAssembler,
    private readonly factCheckerAiService: FactCheckerAiService,
    private readonly configService: ConfigService,
    @InjectQueue(FACT_CHECK_QUEUE)
    private readonly factCheckQueue: Queue<FactCheckJobData>,
  ) {}

  async process(
    factCheckBatchTaskId: string,
    job?: Job<FactCheckJobData>,
  ): Promise<void> {
    const claimed = await this.claimTask(factCheckBatchTaskId);

    if (!claimed) {
      await this.handleUnclaimedTask(factCheckBatchTaskId);
      return;
    }

    try {
      const input = await this.inputAssembler.assemble(factCheckBatchTaskId);
      validateFactCheckBatchInput(input, {
        maxTargetsPerBatch: this.configService.get<number>(
          "FACT_CHECK_MAX_TARGETS_PER_BATCH",
          DEFAULT_MAX_FACT_CHECK_TARGETS_PER_BATCH,
        ),
      });

      const { output, groundedEvidence } =
        await this.factCheckerAiService.check(input);

      validateFactCheckBatchOutput(input, output, groundedEvidence, {
        maxReasonLength: this.configService.get<number>(
          "FACT_CHECK_MAX_REASON_LENGTH",
          DEFAULT_MAX_FACT_CHECK_REASON_LENGTH,
        ),
        maxSourcesPerResult: this.configService.get<number>(
          "FACT_CHECK_MAX_SOURCES_PER_RESULT",
          DEFAULT_MAX_FACT_CHECK_SOURCES_PER_RESULT,
        ),
      });

      const entities = mapFactCheckBatchOutputToEntities(
        factCheckBatchTaskId,
        output,
        groundedEvidence,
        new Date(),
      );

      await this.saveResultsAndCompleteTask(factCheckBatchTaskId, entities);
      await this.transitionDebateToJudgingIfReady(factCheckBatchTaskId);
    } catch (error) {
      await this.handleProcessingFailure(factCheckBatchTaskId, job, error);

      if (error instanceof NonRetryableFactCheckError) {
        return;
      }

      throw error;
    }
  }

  async enqueuePendingTasks(
    limit = FACT_CHECK_RECOVERY_BATCH_SIZE,
  ): Promise<number> {
    const tasks = await this.dataSource
      .getRepository(FactCheckBatchTaskEntity)
      .find({
        where: { status: FactCheckBatchTaskStatus.PENDING },
        order: { createdAt: "ASC" },
        take: limit,
      });

    let enqueuedCount = 0;

    for (const task of tasks) {
      const enqueued = await this.enqueueTask(task.id);

      if (enqueued) {
        enqueuedCount += 1;
      }
    }

    return enqueuedCount;
  }

  async resetStaleProcessingTasks(staleBefore: Date): Promise<number> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(FactCheckBatchTaskEntity)
      .set({
        status: FactCheckBatchTaskStatus.PENDING,
        processingStartedAt: null,
        failureReason: "Reset stale PROCESSING task for recovery.",
      })
      .where("status = :status", {
        status: FactCheckBatchTaskStatus.PROCESSING,
      })
      .andWhere("processing_started_at < :staleBefore", { staleBefore })
      .execute();

    return result.affected ?? 0;
  }

  private async claimTask(factCheckBatchTaskId: string): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(FactCheckBatchTaskEntity)
      .set({
        status: FactCheckBatchTaskStatus.PROCESSING,
        processingStartedAt: new Date(),
        failureReason: null,
      })
      .where("id = :taskId", { taskId: factCheckBatchTaskId })
      .andWhere("status IN (:...statuses)", {
        statuses: [
          FactCheckBatchTaskStatus.PENDING,
          FactCheckBatchTaskStatus.QUEUED,
        ],
      })
      .execute();

    return result.affected === 1;
  }

  private async handleUnclaimedTask(
    factCheckBatchTaskId: string,
  ): Promise<void> {
    const task = await this.dataSource
      .getRepository(FactCheckBatchTaskEntity)
      .findOne({
        where: { id: factCheckBatchTaskId },
      });

    if (!task) {
      throw new NonRetryableFactCheckError(
        `FactCheckBatchTask not found: ${factCheckBatchTaskId}.`,
      );
    }

    if (
      [
        FactCheckBatchTaskStatus.PROCESSING,
        FactCheckBatchTaskStatus.COMPLETED,
        FactCheckBatchTaskStatus.FAILED,
      ].includes(task.status)
    ) {
      return;
    }

    throw new FactCheckConflictError(
      `FactCheckBatchTask cannot be claimed: ${factCheckBatchTaskId} (${task.status}).`,
    );
  }

  private async saveResultsAndCompleteTask(
    factCheckBatchTaskId: string,
    entities: {
      results: Array<Partial<FactCheckResultEntity>>;
      sources: Array<Partial<FactCheckSourceEntity>>;
    },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (entities.results.length > 0) {
        await manager.insert(FactCheckResultEntity, entities.results);
      }

      if (entities.sources.length > 0) {
        await manager.insert(FactCheckSourceEntity, entities.sources);
      }

      const completeResult = await manager
        .createQueryBuilder()
        .update(FactCheckBatchTaskEntity)
        .set({
          status: FactCheckBatchTaskStatus.COMPLETED,
          completedAt: new Date(),
          failureReason: null,
        })
        .where("id = :taskId", { taskId: factCheckBatchTaskId })
        .andWhere("status = :status", {
          status: FactCheckBatchTaskStatus.PROCESSING,
        })
        .execute();

      if (completeResult.affected !== 1) {
        throw new FactCheckConflictError(
          `FactCheckBatchTask completion state changed: ${factCheckBatchTaskId}.`,
        );
      }
    });
  }

  private async handleProcessingFailure(
    factCheckBatchTaskId: string,
    job: Job<FactCheckJobData> | undefined,
    error: unknown,
  ): Promise<void> {
    const finalFailure =
      error instanceof NonRetryableFactCheckError || this.isFinalAttempt(job);
    const status = finalFailure
      ? FactCheckBatchTaskStatus.FAILED
      : FactCheckBatchTaskStatus.QUEUED;

    await this.dataSource
      .createQueryBuilder()
      .update(FactCheckBatchTaskEntity)
      .set({
        status,
        processingStartedAt: null,
        failureReason: toSafeFailureReason(error),
      })
      .where("id = :taskId", { taskId: factCheckBatchTaskId })
      .andWhere("status = :status", {
        status: FactCheckBatchTaskStatus.PROCESSING,
      })
      .execute();
  }

  private isFinalAttempt(job: Job<FactCheckJobData> | undefined): boolean {
    if (!job) {
      return true;
    }

    const attempts =
      typeof job.opts.attempts === "number" ? job.opts.attempts : 1;

    return job.attemptsMade + 1 >= attempts;
  }

  private async enqueueTask(factCheckBatchTaskId: string): Promise<boolean> {
    const job = await this.factCheckQueue.add(
      FACT_CHECK_BATCH_JOB,
      { factCheckBatchTaskId },
      {
        jobId: factCheckBatchTaskId,
        attempts: FACT_CHECK_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: FACT_CHECK_JOB_BACKOFF_DELAY_MS,
        },
      },
    );

    const result = await this.dataSource
      .createQueryBuilder()
      .update(FactCheckBatchTaskEntity)
      .set({
        status: FactCheckBatchTaskStatus.QUEUED,
        bullMqJobId: String(job.id),
      })
      .where("id = :taskId", { taskId: factCheckBatchTaskId })
      .andWhere("status IN (:...statuses)", {
        statuses: [
          FactCheckBatchTaskStatus.PENDING,
          FactCheckBatchTaskStatus.QUEUED,
        ],
      })
      .execute();

    return result.affected === 1;
  }

  private async transitionDebateToJudgingIfReady(
    factCheckBatchTaskId: string,
  ): Promise<void> {
    const task = await this.dataSource
      .getRepository(FactCheckBatchTaskEntity)
      .createQueryBuilder("task")
      .innerJoinAndSelect("task.turn", "turn")
      .innerJoinAndSelect("turn.debate", "debate")
      .where("task.id = :taskId", { taskId: factCheckBatchTaskId })
      .getOne();

    if (!task || task.turn.debate.status !== DebateStatus.FINAL_FACT_CHECKING) {
      return;
    }

    const incompleteTaskCount = await this.dataSource
      .getRepository(FactCheckBatchTaskEntity)
      .createQueryBuilder("task")
      .innerJoin("task.turn", "turn")
      .where("turn.debate_id = :debateId", { debateId: task.turn.debateId })
      .andWhere("task.status <> :status", {
        status: FactCheckBatchTaskStatus.COMPLETED,
      })
      .getCount();

    if (incompleteTaskCount > 0) {
      return;
    }

    await this.dataSource
      .createQueryBuilder()
      .update(DebateEntity)
      .set({ status: DebateStatus.JUDGING })
      .where("id = :debateId", { debateId: task.turn.debateId })
      .andWhere("status = :status", {
        status: DebateStatus.FINAL_FACT_CHECKING,
      })
      .execute();
  }
}

function toSafeFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 1000);
  }

  return "Unknown fact check processing failure.";
}
