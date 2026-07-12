import { JudgmentWinner } from "../../debates/domain/debate.enums";
import { JudgeOutput } from "../dto/judge.dto";

export interface CalculatedJudgmentScores {
  sideATotalScore: number;
  sideBTotalScore: number;
}

export function calculateJudgmentScores(
  output: JudgeOutput,
): CalculatedJudgmentScores {
  return {
    sideATotalScore:
      output.sideAArgumentationScore +
      output.sideAInteractionScore +
      output.sideAFactualReliabilityScore,
    sideBTotalScore:
      output.sideBArgumentationScore +
      output.sideBInteractionScore +
      output.sideBFactualReliabilityScore,
  };
}

export function determineJudgmentWinner(
  sideATotalScore: number,
  sideBTotalScore: number,
): JudgmentWinner {
  if (sideATotalScore > sideBTotalScore) {
    return JudgmentWinner.SIDE_A;
  }

  if (sideBTotalScore > sideATotalScore) {
    return JudgmentWinner.SIDE_B;
  }

  return JudgmentWinner.DRAW;
}
