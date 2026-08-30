import { Job } from "bullmq";
import { JudgeJobData } from "./queues/judge.constants";

export function isFinalJudgeAttempt(
  job: Job<JudgeJobData> | undefined,
): boolean {
  if (!job) return true;
  const attempts =
    typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

export function toJudgeFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 1000);
  }
  return "Unknown judge processing failure.";
}

export function toJudgeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; status?: unknown };
    const code = candidate.code ?? candidate.status;
    if (typeof code === "string" || typeof code === "number") {
      return String(code).slice(0, 100);
    }
  }
  return error instanceof Error ? error.name.slice(0, 100) : "UNKNOWN";
}
