import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { DataSource } from "typeorm";
import { JudgeTaskStatus } from "../debates/domain/debate.enums";
import { JudgeTaskEntity } from "../debates/entities/judge-task.entity";
import {
  JUDGE_JOB_ATTEMPTS,
  JUDGE_JOB_BACKOFF_DELAY_MS,
  JUDGE_JOB_BACKOFF_JITTER,
  JUDGE_RECOVERY_BATCH_SIZE,
} from "./constants";
import { JUDGE_JOB, JUDGE_QUEUE, JudgeJobData } from "./queues/judge.constants";

@Injectable()
export class JudgeQueueService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(JUDGE_QUEUE)
    private readonly queue: Queue<JudgeJobData>,
  ) {}

  async enqueueTask(taskId: string): Promise<string> {
    const job = await this.ensureJob(taskId);
    await this.dataSource
      .createQueryBuilder()
      .update(JudgeTaskEntity)
      .set({ bullMqJobId: String(job.id) })
      .where("id = :taskId", { taskId })
      .andWhere("status = :status", { status: JudgeTaskStatus.PENDING })
      .execute();
    return String(job.id);
  }

  async enqueuePendingTasks(
    limit = JUDGE_RECOVERY_BATCH_SIZE,
  ): Promise<number> {
    const tasks = await this.dataSource.getRepository(JudgeTaskEntity).find({
      where: { status: JudgeTaskStatus.PENDING },
      order: { createdAt: "ASC" },
      take: limit,
    });

    for (const task of tasks) {
      await this.enqueueTask(task.id);
    }
    return tasks.length;
  }

  async resetStaleProcessingTasks(staleBefore: Date): Promise<number> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(JudgeTaskEntity)
      .set({
        status: JudgeTaskStatus.PENDING,
        processingStartedAt: null,
        failureReason: "Reset stale PROCESSING task for recovery.",
      })
      .where("status = :status", { status: JudgeTaskStatus.PROCESSING })
      .andWhere("processing_started_at < :staleBefore", { staleBefore })
      .execute();
    return result.affected ?? 0;
  }

  async retryTaskForDebate(
    debateId: string,
    staleBefore: Date,
  ): Promise<boolean> {
    const task = await this.dataSource.getRepository(JudgeTaskEntity).findOne({
      where: { debateId },
    });
    if (!task || task.status === JudgeTaskStatus.COMPLETED) return false;

    if (task.status === JudgeTaskStatus.PROCESSING) {
      if (task.processingStartedAt && task.processingStartedAt >= staleBefore) {
        return false;
      }
      const reset = await this.dataSource
        .createQueryBuilder()
        .update(JudgeTaskEntity)
        .set({
          status: JudgeTaskStatus.PENDING,
          processingStartedAt: null,
          failureReason: "Reset stale PROCESSING task for manual retry.",
        })
        .where("id = :taskId", { taskId: task.id })
        .andWhere("status = :status", { status: JudgeTaskStatus.PROCESSING })
        .execute();
      if (reset.affected !== 1) return false;
    } else if (task.status === JudgeTaskStatus.FAILED) {
      const reset = await this.dataSource
        .createQueryBuilder()
        .update(JudgeTaskEntity)
        .set({
          status: JudgeTaskStatus.PENDING,
          processingStartedAt: null,
          completedAt: null,
          lastErrorCode: null,
          failureReason: null,
        })
        .where("id = :taskId", { taskId: task.id })
        .andWhere("status = :status", { status: JudgeTaskStatus.FAILED })
        .execute();
      if (reset.affected !== 1) return false;
    }

    await this.enqueueTask(task.id);
    return true;
  }

  async removeTaskJob(taskId: string): Promise<void> {
    const job = await this.queue.getJob(taskId);
    if (!job) return;
    const state = await job.getState();
    if (state !== "active" && state !== "completed") {
      await job.remove();
    }
  }

  private async ensureJob(taskId: string): Promise<Job<JudgeJobData>> {
    const existingJob = await this.queue.getJob(taskId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "failed") {
        await existingJob.retry();
        return existingJob;
      }
      if (state !== "completed") return existingJob;
      await existingJob.remove();
    }

    return this.queue.add(
      JUDGE_JOB,
      { taskId },
      {
        jobId: taskId,
        attempts: JUDGE_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: JUDGE_JOB_BACKOFF_DELAY_MS,
          jitter: JUDGE_JOB_BACKOFF_JITTER,
        },
      },
    );
  }
}
