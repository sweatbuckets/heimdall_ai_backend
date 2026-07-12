import { randomUUID } from "node:crypto";
import { JudgmentResultEntity } from "../../debates/entities/judgment-result.entity";
import {
  calculateJudgmentScores,
  determineJudgmentWinner,
} from "../calculators/judgment.calculator";
import { JudgeOutput } from "../dto/judge.dto";

export function mapJudgeOutputToJudgmentResult(
  debateId: string,
  output: JudgeOutput,
  judgedAt: Date,
): Partial<JudgmentResultEntity> {
  const { sideATotalScore, sideBTotalScore } = calculateJudgmentScores(output);

  return {
    id: randomUUID(),
    debateId,
    winner: determineJudgmentWinner(sideATotalScore, sideBTotalScore),
    sideAArgumentationScore: output.sideAArgumentationScore,
    sideAInteractionScore: output.sideAInteractionScore,
    sideAFactualReliabilityScore: output.sideAFactualReliabilityScore,
    sideATotalScore,
    sideBArgumentationScore: output.sideBArgumentationScore,
    sideBInteractionScore: output.sideBInteractionScore,
    sideBFactualReliabilityScore: output.sideBFactualReliabilityScore,
    sideBTotalScore,
    overallReason: output.overallReason.trim(),
    sideAFeedback: output.sideAFeedback.trim(),
    sideBFeedback: output.sideBFeedback.trim(),
    judgedAt,
  };
}
