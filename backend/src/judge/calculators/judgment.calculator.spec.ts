import { JudgmentWinner } from "../../debates/domain/debate.enums";
import {
  calculateJudgmentScores,
  determineJudgmentWinner,
} from "./judgment.calculator";

describe("judgment calculator", () => {
  it("calculates total scores", () => {
    expect(
      calculateJudgmentScores({
        sideAArgumentationScore: 33,
        sideAInteractionScore: 24,
        sideAFactualReliabilityScore: 21,
        sideBArgumentationScore: 29,
        sideBInteractionScore: 22,
        sideBFactualReliabilityScore: 18,
        overallReason: "Reason.",
        sideAFeedback: "A.",
        sideBFeedback: "B.",
      }),
    ).toEqual({
      sideATotalScore: 78,
      sideBTotalScore: 69,
    });
  });

  it("determines SIDE_A winner", () => {
    expect(determineJudgmentWinner(78, 69)).toBe(JudgmentWinner.SIDE_A);
  });

  it("determines SIDE_B winner", () => {
    expect(determineJudgmentWinner(68, 70)).toBe(JudgmentWinner.SIDE_B);
  });

  it("determines DRAW", () => {
    expect(determineJudgmentWinner(70, 70)).toBe(JudgmentWinner.DRAW);
  });
});
