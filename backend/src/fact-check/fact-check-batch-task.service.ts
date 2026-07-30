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
import { FactCheckBatchTaskStatus } from "../debates/domain/debate.enums";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";
import { FactCheckResultEntity } from "../debates/entities/fact-check-result.entity";
import { FactCheckSourceEntity } from "../debates/entities/fact-check-source.entity";
import { JudgeReadinessService } from "../judge/judge-readiness.service";

@Injectable()
export class FactCheckBatchTaskService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inputAssembler: FactCheckInputAssembler,
    private readonly factCheckerAiService: FactCheckerAiService,
    private readonly configService: ConfigService,
    @InjectQueue(FACT_CHECK_QUEUE)
    private readonly factCheckQueue: Queue<FactCheckJobData>,
    private readonly judgeReadinessService: JudgeReadinessService,
  ) {}

  async process(
    factCheckBatchTaskId: string,
    job?: Job<FactCheckJobData>,
  ): Promise<void> {
    const claimed = await this.claimTask(factCheckBatchTaskId);

    if (!claimed) {
      const completedDebateId =
        await this.handleUnclaimedTask(factCheckBatchTaskId);

      if (completedDebateId) {
        await this.judgeReadinessService.tryStartJudge(completedDebateId);
      }

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
      await this.judgeReadinessService.tryStartJudge(input.debate.id);
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
      .andWhere("status = :status", {
        status: FactCheckBatchTaskStatus.PENDING,
      })
      .execute();

    return result.affected === 1;
  }

  private async handleUnclaimedTask(
    factCheckBatchTaskId: string,
  ): Promise<string | null> {
    const task = await this.dataSource
      .getRepository(FactCheckBatchTaskEntity)
      .findOne({
        where: { id: factCheckBatchTaskId },
        relations: { turn: true },
      });

    if (!task) {
      throw new NonRetryableFactCheckError(
        `FactCheckBatchTask not found: ${factCheckBatchTaskId}.`,
      );
    }

    if (task.status === FactCheckBatchTaskStatus.COMPLETED) {
      return task.turn?.debateId ?? null;
    }

    if (
      [
        FactCheckBatchTaskStatus.PROCESSING,
        FactCheckBatchTaskStatus.FAILED,
      ].includes(task.status)
    ) {
      return null;
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
      : FactCheckBatchTaskStatus.PENDING;

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
    const job = await this.ensureBullMqJob(factCheckBatchTaskId);

    await this.dataSource
      .createQueryBuilder()
      .update(FactCheckBatchTaskEntity)
      .set({
        bullMqJobId: String(job.id),
      })
      .where("id = :taskId", { taskId: factCheckBatchTaskId })
      .andWhere("status = :status", {
        status: FactCheckBatchTaskStatus.PENDING,
      })
      .execute();

    return true;
  }

  private async ensureBullMqJob(
    factCheckBatchTaskId: string,
  ): Promise<Job<FactCheckJobData>> {
    const jobId = factCheckBatchTaskId;
    const existingJob = await this.factCheckQueue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();

      if (state === "failed") {
        await existingJob.retry();
        return existingJob;
      }

      if (state !== "completed") {
        return existingJob;
      }

      await existingJob.remove();
    }

    return this.factCheckQueue.add(
      FACT_CHECK_BATCH_JOB,
      { factCheckBatchTaskId },
      {
        jobId,
        attempts: FACT_CHECK_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: FACT_CHECK_JOB_BACKOFF_DELAY_MS,
        },
      },
    );
  }
}

function toSafeFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 1000);
  }

  return "Unknown fact check processing failure.";
}
