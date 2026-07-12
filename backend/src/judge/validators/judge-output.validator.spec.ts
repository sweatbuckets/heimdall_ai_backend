import { JudgeOutput } from "../dto/judge.dto";
import { InvalidJudgeOutputError } from "../errors/judge.errors";
import { validateJudgeOutput } from "./judge-output.validator";

describe("validateJudgeOutput", () => {
  const output: JudgeOutput = {
    sideAArgumentationScore: 33,
    sideAInteractionScore: 24,
    sideAFactualReliabilityScore: 21,
    sideBArgumentationScore: 29,
    sideBInteractionScore: 22,
    sideBFactualReliabilityScore: 18,
    overallReason: "SIDE_A was stronger overall.",
    sideAFeedback: "Good argument structure.",
    sideBFeedback: "Needs stronger evidence.",
  };

  it("accepts valid integer scores and text", () => {
    expect(() => validateJudgeOutput(output)).not.toThrow();
  });

  it("rejects score range overflow", () => {
    expect(() =>
      validateJudgeOutput({
        ...output,
        sideAArgumentationScore: 41,
      }),
    ).toThrow(InvalidJudgeOutputError);
  });

  it("rejects decimal scores", () => {
    expect(() =>
      validateJudgeOutput({
        ...output,
        sideAInteractionScore: 24.5,
      }),
    ).toThrow(InvalidJudgeOutputError);
  });

  it("rejects empty evaluation text", () => {
    expect(() =>
      validateJudgeOutput({
        ...output,
        overallReason: "   ",
      }),
    ).toThrow(InvalidJudgeOutputError);
  });
});
