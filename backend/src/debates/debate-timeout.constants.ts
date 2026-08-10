export const DEBATE_TOTAL_DURATION_MS = 27 * 60 * 1000;
export const DEBATE_TOTAL_DURATION_SECONDS = DEBATE_TOTAL_DURATION_MS / 1000;

export function getDebateExpiresAt(startedAt: Date | null): Date | null {
  return startedAt
    ? new Date(startedAt.getTime() + DEBATE_TOTAL_DURATION_MS)
    : null;
}
