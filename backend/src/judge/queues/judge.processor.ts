import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { DataSource } from "typeorm";
import { DebateProcessingEventBus } from "../../ai/debate-processing-event-bus";
import { JudgeTaskEntity } from "../../debates/entities/judge-task.entity";
import { JudgeTaskService } from "../judge-task.service";
import { JUDGE_JOB, JUDGE_QUEUE, JudgeJobData } from "./judge.constants";

@Processor(JUDGE_QUEUE)
export class JudgeProcessor extends WorkerHost {
  private readonly logger = new Logger(JudgeProcessor.name);

  constructor(
    private readonly taskService: JudgeTaskService,
    private readonly dataSource: DataSource,
    private readonly processingEventBus: DebateProcessingEventBus,
  ) {
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
    await this.publishProcessing(job.data.taskId, "STARTED", attempt);
    try {
      await this.taskService.process(job.data.taskId, job);
      this.logger.log(
        `Judge completed. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} durationMs=${Date.now() - startedAt}`,
      );
      await this.publishProcessing(job.data.taskId, "COMPLETED", attempt);
    } catch (error) {
      if (attempt < maxAttempts) {
        await this.publishProcessing(job.data.taskId, "RETRYING", attempt);
        this.logger.warn(
          `Judge failed; automatic retry pending. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} retryDelayMs=${getRetryDelayRange(job, attempt)} durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`,
        );
      } else {
        await this.publishProcessing(job.data.taskId, "FAILED", attempt);
        this.logger.error(
          `Judge permanently failed. jobId=${String(job.id)} taskId=${job.data.taskId} attempt=${attempt}/${maxAttempts} durationMs=${Date.now() - startedAt}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      throw error;
    }
  }

  private async publishProcessing(
    taskId: string,
    status: "STARTED" | "RETRYING" | "COMPLETED" | "FAILED",
    attempt: number,
  ): Promise<void> {
    const task = await this.dataSource.getRepository(JudgeTaskEntity).findOne({
      where: { id: taskId },
    });
    if (!task) return;
    this.processingEventBus.publish({
      type: "debate.processing.stage",
      id: `judge:${task.debateId}`,
      debateId: task.debateId,
      stage: "JUDGE",
      status,
      attempt,
      message: status === "RETRYING"
        ? "[판정 재시도 중] 점수 계산 및 최종 판정 결과 재생성..."
        : status === "COMPLETED"
          ? "[판정 완료] 토론 결과 확정"
          : status === "FAILED"
            ? "[판정 실패] 토론 결과 생성 실패"
            : "[판정 중] 점수 계산 및 최종 판정 결과 생성...",
      occurredAt: new Date().toISOString(),
    });
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
