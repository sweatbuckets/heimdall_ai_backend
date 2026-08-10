import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import {
  ANALYZER_QUEUE,
  ANALYZE_TURN_JOB,
  ANALYZE_TURN_JOB_ATTEMPTS,
  ANALYZE_TURN_JOB_BACKOFF_DELAY_MS,
} from "../constants";
import { AnalyzeTurnJobData } from "./analyzer-job.data";

@Injectable()
export class AnalyzerQueueService {
  constructor(
    @InjectQueue(ANALYZER_QUEUE)
    private readonly analyzerQueue: Queue<AnalyzeTurnJobData>,
  ) {}

  async enqueueAnalyzeTurn(turnId: string): Promise<string> {
    return this.enqueue(turnId, `${ANALYZE_TURN_JOB}-${turnId}`);
  }

  async enqueueRecoveredAnalyzeTurn(turnId: string): Promise<string> {
    const job = await this.ensureJob(turnId);
    return String(job.id);
  }

  async enqueuePendingAnalyzeTurn(turnId: string): Promise<string> {
    const job = await this.ensureJob(turnId);
    return String(job.id);
  }

  async cancelAnalyzeTurn(turnId: string): Promise<void> {
    const job = await this.analyzerQueue.getJob(
      `${ANALYZE_TURN_JOB}-${turnId}`,
    );
    if (!job) return;
    const state = await job.getState();
    if (state !== "active" && state !== "completed") {
      await job.remove();
    }
  }

  private async enqueue(turnId: string, jobId: string): Promise<string> {
    const job = await this.analyzerQueue.add(
      ANALYZE_TURN_JOB,
      { turnId },
      {
        jobId,
        attempts: ANALYZE_TURN_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: ANALYZE_TURN_JOB_BACKOFF_DELAY_MS,
        },
      },
    );

    return String(job.id);
  }

  private async ensureJob(turnId: string): Promise<Job<AnalyzeTurnJobData>> {
    const jobId = `${ANALYZE_TURN_JOB}-${turnId}`;
    const existingJob = await this.analyzerQueue.getJob(jobId);

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

    return this.analyzerQueue.add(
      ANALYZE_TURN_JOB,
      { turnId },
      {
        jobId,
        attempts: ANALYZE_TURN_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: ANALYZE_TURN_JOB_BACKOFF_DELAY_MS,
        },
      },
    );
  }
}
