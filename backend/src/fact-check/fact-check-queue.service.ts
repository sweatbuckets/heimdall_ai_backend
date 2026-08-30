import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { DataSource } from "typeorm";
import {
  FactCheckStage,
  FactCheckStageTaskStatus,
} from "../debates/domain/debate.enums";
import { FactCheckStageTaskEntity } from "../debates/entities/fact-check-stage-task.entity";
import {
  FACT_CHECK_JOB_ATTEMPTS,
  FACT_CHECK_JOB_BACKOFF_DELAY_MS,
  FACT_CHECK_JOB_BACKOFF_JITTER,
  FACT_CHECK_RECOVERY_BATCH_SIZE,
} from "./constants";
import {
  FACT_CHECK_GROUNDING_JOB,
  FACT_CHECK_GROUNDING_QUEUE,
  FACT_CHECK_SYNTHESIS_JOB,
  FACT_CHECK_SYNTHESIS_QUEUE,
  FactCheckStageJobData,
} from "./queues/fact-check.constants";

@Injectable()
export class FactCheckQueueService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(FACT_CHECK_GROUNDING_QUEUE)
    private readonly groundingQueue: Queue<FactCheckStageJobData>,
    @InjectQueue(FACT_CHECK_SYNTHESIS_QUEUE)
    private readonly synthesisQueue: Queue<FactCheckStageJobData>,
  ) {}

  async enqueueGroundingTask(taskId: string): Promise<string> {
    return this.enqueueTask(taskId, FactCheckStage.GROUNDING);
  }

  async enqueueSynthesisTask(taskId: string): Promise<string> {
    return this.enqueueTask(taskId, FactCheckStage.SYNTHESIS);
  }

  async enqueuePendingTasks(
    limit = FACT_CHECK_RECOVERY_BATCH_SIZE,
  ): Promise<number> {
    const tasks = await this.dataSource
      .getRepository(FactCheckStageTaskEntity)
      .find({
        where: { status: FactCheckStageTaskStatus.PENDING },
        order: { createdAt: "ASC" },
        take: limit,
      });

    let count = 0;
    for (const task of tasks) {
      await this.enqueueTask(task.id, task.stage);
      count += 1;
    }
    return count;
  }

  async resetStaleProcessingTasks(staleBefore: Date): Promise<number> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(FactCheckStageTaskEntity)
      .set({
        status: FactCheckStageTaskStatus.PENDING,
        processingStartedAt: null,
        failureReason: "Reset stale PROCESSING task for recovery.",
      })
      .where("status = :status", {
        status: FactCheckStageTaskStatus.PROCESSING,
      })
      .andWhere("processing_started_at < :staleBefore", { staleBefore })
      .execute();

    return result.affected ?? 0;
  }

  private async enqueueTask(
    taskId: string,
    stage: FactCheckStage,
  ): Promise<string> {
    const queue = this.queueFor(stage);
    const jobName = this.jobNameFor(stage);
    const job = await this.ensureJob(queue, jobName, taskId);

    await this.dataSource
      .createQueryBuilder()
      .update(FactCheckStageTaskEntity)
      .set({ bullMqJobId: String(job.id) })
      .where("id = :taskId", { taskId })
      .andWhere("stage = :stage", { stage })
      .andWhere("status = :status", {
        status: FactCheckStageTaskStatus.PENDING,
      })
      .execute();

    return String(job.id);
  }

  private async ensureJob(
    queue: Queue<FactCheckStageJobData>,
    jobName: string,
    taskId: string,
  ): Promise<Job<FactCheckStageJobData>> {
    const existingJob = await queue.getJob(taskId);
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

    return queue.add(
      jobName,
      { taskId },
      {
        jobId: taskId,
        attempts: FACT_CHECK_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: FACT_CHECK_JOB_BACKOFF_DELAY_MS,
          jitter: FACT_CHECK_JOB_BACKOFF_JITTER,
        },
      },
    );
  }

  private queueFor(stage: FactCheckStage): Queue<FactCheckStageJobData> {
    return stage === FactCheckStage.GROUNDING
      ? this.groundingQueue
      : this.synthesisQueue;
  }

  private jobNameFor(stage: FactCheckStage): string {
    return stage === FactCheckStage.GROUNDING
      ? FACT_CHECK_GROUNDING_JOB
      : FACT_CHECK_SYNTHESIS_JOB;
  }
}
