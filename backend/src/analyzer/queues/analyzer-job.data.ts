import { DebatePhase } from "../../debates/domain/debate.enums";

export interface AnalyzeRoundJobData {
  anchorTurnId: string;
  debateId: string;
  phase: DebatePhase;
  round: number;
}
