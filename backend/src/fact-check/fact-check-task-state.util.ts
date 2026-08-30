import { Job } from "bullmq";
import { FactCheckStageJobData } from "./queues/fact-check.constants";

export function isFinalFactCheckAttempt(
  job: Job<FactCheckStageJobData> | undefined,
): boolean {
  if (!job) return true;
  const attempts =
    typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

export function toFactCheckFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 1000);
  }
  return "Unknown fact check processing failure.";
}

export function toFactCheckErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; status?: unknown };
    const code = candidate.code ?? candidate.status;
    if (typeof code === "string" || typeof code === "number") {
      return String(code).slice(0, 100);
    }
  }
  return error instanceof Error ? error.name.slice(0, 100) : "UNKNOWN";
}
