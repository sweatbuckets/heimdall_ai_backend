export const DEBATE_PREPARATION_DURATION_MS = 10 * 1000;
export const OPENING_TURN_LIMIT_SECONDS = 90;
export const DEFAULT_TURN_LIMIT_SECONDS = 180;

const FIXED_TURN_COUNT = 4;
const REBUTTAL_TURN_COUNT_PER_ROUND = 2;
const DEBATE_COMPLETION_GRACE_MS = 3 * 60 * 1000;

export const DEBATE_FIXED_DURATION_MS =
  FIXED_TURN_COUNT * OPENING_TURN_LIMIT_SECONDS * 1000 +
  DEBATE_COMPLETION_GRACE_MS;
export const DEBATE_DURATION_PER_ROUND_MS =
  REBUTTAL_TURN_COUNT_PER_ROUND * DEFAULT_TURN_LIMIT_SECONDS * 1000;

export function getDebateTotalDurationMs(
  rebuttalQuestionRounds: number,
): number {
  return (
    DEBATE_FIXED_DURATION_MS +
    rebuttalQuestionRounds * DEBATE_DURATION_PER_ROUND_MS
  );
}

export function getDebateExpiresAt(
  startedAt: Date | null,
  rebuttalQuestionRounds: number,
): Date | null {
  return startedAt
    ? new Date(
        startedAt.getTime() + getDebateTotalDurationMs(rebuttalQuestionRounds),
      )
    : null;
}

export function isDebateLiveExpired(
  debate: Pick<
    { startedAt: Date | null; rebuttalQuestionRounds: number },
    "startedAt" | "rebuttalQuestionRounds"
  >,
  now = Date.now(),
): boolean {
  return (
    debate.startedAt != null &&
    now >=
      debate.startedAt.getTime() +
        getDebateTotalDurationMs(debate.rebuttalQuestionRounds)
  );
}

export function getDebateStartsAt(now = new Date()): Date {
  return new Date(now.getTime() + DEBATE_PREPARATION_DURATION_MS);
}
