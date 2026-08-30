import { DebatePhase } from "../debates/domain/debate.enums";
import {
  DEFAULT_TURN_LIMIT_SECONDS,
  OPENING_TURN_LIMIT_SECONDS,
} from "../debates/debate-timeout.constants";

export { DEFAULT_TURN_LIMIT_SECONDS, OPENING_TURN_LIMIT_SECONDS };

export function getDebateTurnLimitSeconds(phase: DebatePhase): number {
  return phase === DebatePhase.OPENING || phase === DebatePhase.CLOSING
    ? OPENING_TURN_LIMIT_SECONDS
    : DEFAULT_TURN_LIMIT_SECONDS;
}

export function getDebateTurnLimitMs(phase: DebatePhase): number {
  return getDebateTurnLimitSeconds(phase) * 1000;
}
