import { DebatePhase } from "../debates/domain/debate.enums";

export const OPENING_TURN_LIMIT_SECONDS = 90;
export const DEFAULT_TURN_LIMIT_SECONDS = 180;

export function getDebateTurnLimitSeconds(phase: DebatePhase): number {
  return phase === DebatePhase.OPENING || phase === DebatePhase.CLOSING
    ? OPENING_TURN_LIMIT_SECONDS
    : DEFAULT_TURN_LIMIT_SECONDS;
}

export function getDebateTurnLimitMs(phase: DebatePhase): number {
  return getDebateTurnLimitSeconds(phase) * 1000;
}
