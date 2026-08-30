import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { JudgeTaskService } from "../judge-task.service";
import { JUDGE_JOB, JUDGE_QUEUE, JudgeJobData } from "./judge.constants";

@Processor(JUDGE_QUEUE)
export class JudgeProcessor extends WorkerHost {
  private readonly logger = new Logger(JudgeProcessor.name);

  constructor(private readonly taskService: JudgeTaskService) {
    super();
  }

  async process(job: Job<JudgeJobData>): Promise<void> {
    if (job.name !== JUDGE_JOB) return;
    const startedAt = Date.now();
    const attempt = job.attemptsMade + 1;
    const maxAttempts =
      typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
    this.logger.log(
      `Judge started. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts}`,
    );
    try {
      await this.taskService.process(job.data.taskId, job);
      this.logger.log(
        `Judge completed. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      if (attempt < maxAttempts) {
        this.logger.warn(
          `Judge failed; automatic retry pending. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} retryDelayMs=${getRetryDelayRange(job, attempt)} durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`,
        );
      } else {
        this.logger.error(
          `Judge permanently failed. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} durationMs=${Date.now() - startedAt}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      throw error;
    }
  }
}

function getRetryDelayRange(
  job: Job<JudgeJobData>,
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
