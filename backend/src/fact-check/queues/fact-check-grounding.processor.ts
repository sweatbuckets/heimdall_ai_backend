import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { FACT_CHECK_WORKER_CONCURRENCY } from "../constants";
import { FactCheckGroundingTaskService } from "../fact-check-grounding-task.service";
import {
  FACT_CHECK_GROUNDING_JOB,
  FACT_CHECK_GROUNDING_QUEUE,
  FactCheckStageJobData,
} from "./fact-check.constants";

@Processor(FACT_CHECK_GROUNDING_QUEUE, {
  concurrency: FACT_CHECK_WORKER_CONCURRENCY,
})
export class FactCheckGroundingProcessor extends WorkerHost {
  private readonly logger = new Logger(FactCheckGroundingProcessor.name);

  constructor(private readonly taskService: FactCheckGroundingTaskService) {
    super();
  }

  async process(job: Job<FactCheckStageJobData>): Promise<void> {
    if (job.name !== FACT_CHECK_GROUNDING_JOB) return;
    const startedAt = Date.now();
    const attempt = job.attemptsMade + 1;
    const maxAttempts =
      typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
    this.logger.log(
      `Fact-check grounding started. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts}`,
    );
    try {
      await this.taskService.process(job.data.taskId, job);
      this.logger.log(
        `Fact-check grounding completed. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      if (attempt < maxAttempts) {
        this.logger.warn(
          `Fact-check grounding failed; automatic retry pending. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} retryDelayMs=${getRetryDelayRange(job, attempt)} durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`,
        );
      } else {
        this.logger.error(
          `Fact-check grounding permanently failed. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} durationMs=${Date.now() - startedAt}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      throw error;
    }
  }
}

function getRetryDelayRange(
  job: Job<FactCheckStageJobData>,
  currentAttempt: number,
): string {
  const backoff = job.opts.backoff;
  if (!backoff || typeof backoff === "number") {
    return String(typeof backoff === "number" ? backoff : 0);
  }
  const delay = backoff.delay ?? 0;
  const maximum =
    backoff.type === "exponential"
      ? delay * 2 ** Math.max(0, currentAttempt - 1)
      : delay;
  const minimum = Math.floor(maximum * (1 - (backoff.jitter ?? 0)));
  return minimum === maximum ? String(maximum) : `${minimum}-${maximum}`;
}
