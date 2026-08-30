import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { DelayedError, Job } from "bullmq";
import {
  ANALYZER_QUEUE,
  ANALYZE_ROUND_DEPENDENCY_RETRY_DELAY_MS,
  ANALYZE_ROUND_JOB,
} from "../constants";
import { AnalyzeTurnService } from "../analyze-turn.service";
import { AnalyzeRoundJobData } from "./analyzer-job.data";
import { AnalyzeTurnDependencyPendingError } from "../errors/analyzer.errors";
import { AnalyzerQueueService } from "./analyzer-queue.service";
import { DebateProcessingEventBus } from "../../ai/debate-processing-event-bus";

@Processor(ANALYZER_QUEUE)
export class AnalyzerProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyzerProcessor.name);

  constructor(
    private readonly analyzeTurnService: AnalyzeTurnService,
    private readonly analyzerQueueService: AnalyzerQueueService,
    private readonly processingEventBus: DebateProcessingEventBus,
  ) {
    super();
  }

  async process(job: Job<AnalyzeRoundJobData>, token?: string): Promise<void> {
    if (job.name !== ANALYZE_ROUND_JOB) {
      return;
    }

    if (!isRoundJobData(job.data)) {
      this.logger.warn(
        `Obsolete turn-level Analyzer job discarded. jobId=${String(job.id)}`,
      );
      return;
    }

    const startedAt = Date.now();
    const attempt = getCurrentAttempt(job);
    const maxAttempts = getMaxAttempts(job);
    this.logger.log(
      `Analyzer round job started. jobId=${String(job.id)} debateId=${job.data.debateId} phase=${job.data.phase} round=${job.data.round} attempt=${attempt}/${maxAttempts}`,
    );
    this.publishProcessing(job.data.debateId, job.data.phase, "STARTED", attempt);

    try {
      const result = await this.analyzeTurnService.analyzeTurn(
        job.data.anchorTurnId,
        job,
      );
      this.logger.log(
        [
          "Analyzer job completed.",
          `jobId=${String(job.id)}`,
          `debateId=${job.data.debateId}`,
          `phase=${job.data.phase}`,
          `round=${job.data.round}`,
          `attempt=${attempt}/${maxAttempts}`,
          `skipped=${result.skipped}`,
          `components=${result.componentCount}`,
          `durationMs=${Date.now() - startedAt}`,
        ].join(" "),
      );
      this.publishProcessing(job.data.debateId, job.data.phase, "COMPLETED", attempt);
      await this.analyzerQueueService.enqueueNextReadyRound(
        job.data.anchorTurnId,
      );
    } catch (error) {
      if (error instanceof AnalyzeTurnDependencyPendingError) {
        const resumeAt = Date.now() + ANALYZE_ROUND_DEPENDENCY_RETRY_DELAY_MS;
        this.logger.log(
          [
            "Analyzer job waiting for round dependency.",
            `jobId=${String(job.id)}`,
            `debateId=${job.data.debateId}`,
            `phase=${job.data.phase}`,
            `round=${job.data.round}`,
            `retryInMs=${ANALYZE_ROUND_DEPENDENCY_RETRY_DELAY_MS}`,
          ].join(" "),
        );
        await job.moveToDelayed(resumeAt, token);
        throw new DelayedError();
      }

      const errorDetails = error instanceof Error ? error.stack : String(error);
      if (attempt < maxAttempts) {
        this.publishProcessing(job.data.debateId, job.data.phase, "RETRYING", attempt);
        this.logger.warn(
          [
            "Analyzer job failed; automatic retry pending.",
            `jobId=${String(job.id)}`,
            `debateId=${job.data.debateId}`,
            `phase=${job.data.phase}`,
            `round=${job.data.round}`,
            `attempt=${attempt}/${maxAttempts}`,
            `retryDelayMs=${getRetryDelayRange(job, attempt)}`,
            `durationMs=${Date.now() - startedAt}`,
            `error=${error instanceof Error ? error.message : String(error)}`,
          ].join(" "),
        );
      } else {
        this.publishProcessing(job.data.debateId, job.data.phase, "FAILED", attempt);
        this.logger.error(
          [
            "Analyzer job permanently failed.",
            `jobId=${String(job.id)}`,
            `debateId=${job.data.debateId}`,
            `phase=${job.data.phase}`,
            `round=${job.data.round}`,
            `attempt=${attempt}/${maxAttempts}`,
            `durationMs=${Date.now() - startedAt}`,
          ].join(" "),
          errorDetails,
        );
      }
      throw error;
    }
  }

  private publishProcessing(
    debateId: string,
    phase: string,
    status: "STARTED" | "RETRYING" | "COMPLETED" | "FAILED",
    attempt: number,
  ): void {
    if (phase !== "CLOSING") return;
    this.processingEventBus.publish({
      type: "debate.processing.stage",
      id: `analyzer:${debateId}`,
      debateId,
      stage: "ANALYZER",
      status,
      attempt,
      message: status === "RETRYING"
        ? "[분석 재시도 중] 발언 간 논리적 연결과 모순 재검사..."
        : status === "COMPLETED"
          ? "[분석 완료] 발언 구조 분석 완료"
          : status === "FAILED"
            ? "[분석 실패] 발언 구조 분석 실패"
            : "[분석 중] 발언 간 논리적 연결과 모순 검사...",
      occurredAt: new Date().toISOString(),
    });
  }
}

function isRoundJobData(data: unknown): data is AnalyzeRoundJobData {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<AnalyzeRoundJobData>;
  return (
    typeof candidate.anchorTurnId === "string" &&
    typeof candidate.debateId === "string" &&
    typeof candidate.phase === "string" &&
    typeof candidate.round === "number"
  );
}

function getMaxAttempts(job: Job<AnalyzeRoundJobData>): number {
  return typeof job.opts?.attempts === "number" ? job.opts.attempts : 1;
}

function getCurrentAttempt(job: Job<AnalyzeRoundJobData>): number {
  return (job.attemptsMade ?? 0) + 1;
}

function getRetryDelayRange(
  job: Job<AnalyzeRoundJobData>,
  currentAttempt: number,
): string {
  const backoff = job.opts?.backoff;
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
