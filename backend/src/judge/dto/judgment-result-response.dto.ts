import { JudgmentWinner } from "../../debates/domain/debate.enums";
import { JudgmentResultEntity } from "../../debates/entities/judgment-result.entity";

export interface JudgmentResultResponseDto {
  id: string;
  debateId: string;
  winner: JudgmentWinner;
  sideAArgumentationScore: number;
  sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;
  sideATotalScore: number;
  sideBArgumentationScore: number;
  sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;
  sideBTotalScore: number;
  overallReason: string;
  sideAFeedback: string;
  sideBFeedback: string;
  judgedAt: string;
}

export function mapJudgmentResultResponse(
  entity: JudgmentResultEntity,
): JudgmentResultResponseDto {
  return {
    id: entity.id,
    debateId: entity.debateId,
    winner: entity.winner,
    sideAArgumentationScore: entity.sideAArgumentationScore,
    sideAInteractionScore: entity.sideAInteractionScore,
    sideAFactualReliabilityScore: entity.sideAFactualReliabilityScore,
    sideATotalScore: entity.sideATotalScore,
    sideBArgumentationScore: entity.sideBArgumentationScore,
    sideBInteractionScore: entity.sideBInteractionScore,
    sideBFactualReliabilityScore: entity.sideBFactualReliabilityScore,
    sideBTotalScore: entity.sideBTotalScore,
    overallReason: entity.overallReason,
    sideAFeedback: entity.sideAFeedback,
    sideBFeedback: entity.sideBFeedback,
    judgedAt: entity.judgedAt.toISOString(),
  };
}
