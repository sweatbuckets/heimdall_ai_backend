import {
  DEFAULT_MAX_JUDGE_FEEDBACK_LENGTH,
  DEFAULT_MAX_JUDGE_OVERALL_REASON_LENGTH,
  JUDGE_ARGUMENTATION_MAX_SCORE,
  JUDGE_FACTUAL_RELIABILITY_MAX_SCORE,
  JUDGE_INTERACTION_MAX_SCORE,
} from "../constants";
import { JudgeOutput } from "../dto/judge.dto";
import { InvalidJudgeOutputError } from "../errors/judge.errors";

export interface JudgeOutputValidationLimits {
  maxOverallReasonLength: number;
  maxFeedbackLength: number;
}

export const DEFAULT_JUDGE_OUTPUT_VALIDATION_LIMITS: JudgeOutputValidationLimits =
  {
    maxOverallReasonLength: DEFAULT_MAX_JUDGE_OVERALL_REASON_LENGTH,
    maxFeedbackLength: DEFAULT_MAX_JUDGE_FEEDBACK_LENGTH,
  };

export function validateJudgeOutput(
  output: JudgeOutput,
  limits: JudgeOutputValidationLimits = DEFAULT_JUDGE_OUTPUT_VALIDATION_LIMITS,
): void {
  validateScore(
    "sideAArgumentationScore",
    output.sideAArgumentationScore,
    JUDGE_ARGUMENTATION_MAX_SCORE,
  );
  validateScore(
    "sideAInteractionScore",
    output.sideAInteractionScore,
    JUDGE_INTERACTION_MAX_SCORE,
  );
  validateScore(
    "sideAFactualReliabilityScore",
    output.sideAFactualReliabilityScore,
    JUDGE_FACTUAL_RELIABILITY_MAX_SCORE,
  );
  validateScore(
    "sideBArgumentationScore",
    output.sideBArgumentationScore,
    JUDGE_ARGUMENTATION_MAX_SCORE,
  );
  validateScore(
    "sideBInteractionScore",
    output.sideBInteractionScore,
    JUDGE_INTERACTION_MAX_SCORE,
  );
  validateScore(
    "sideBFactualReliabilityScore",
    output.sideBFactualReliabilityScore,
    JUDGE_FACTUAL_RELIABILITY_MAX_SCORE,
  );
  validateTexts(output, limits);
}

function validateScore(name: string, value: number, max: number): void {
  if (!Number.isInteger(value)) {
    throw new InvalidJudgeOutputError(`${name} must be an integer.`);
  }

  if (value < 0 || value > max) {
    throw new InvalidJudgeOutputError(`${name} must be between 0 and ${max}.`);
  }
}

function validateTexts(
  output: JudgeOutput,
  limits: JudgeOutputValidationLimits,
): void {
  if (!output.overallReason.trim()) {
    throw new InvalidJudgeOutputError("overallReason must not be empty.");
  }

  if (!output.sideAFeedback.trim()) {
    throw new InvalidJudgeOutputError("sideAFeedback must not be empty.");
  }

  if (!output.sideBFeedback.trim()) {
    throw new InvalidJudgeOutputError("sideBFeedback must not be empty.");
  }

  if (output.overallReason.length > limits.maxOverallReasonLength) {
    throw new InvalidJudgeOutputError("overallReason exceeds maximum length.");
  }

  if (output.sideAFeedback.length > limits.maxFeedbackLength) {
    throw new InvalidJudgeOutputError("sideAFeedback exceeds maximum length.");
  }

  if (output.sideBFeedback.length > limits.maxFeedbackLength) {
    throw new InvalidJudgeOutputError("sideBFeedback exceeds maximum length.");
  }
}
