import {
  DebateSide,
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchTaskStatus,
} from "../../debates/domain/debate.enums";
import { JudgeInput, JudgeValidationContext } from "../dto/judge.dto";
import { JudgeInputError } from "../errors/judge.errors";

export function validateJudgeInput(
  input: JudgeInput,
  context: JudgeValidationContext,
): void {
  validateExecutionState(context);
  validateParticipants(input);
  validateComponents(input);
  validateRelations(input);
  validateFactCheckResults(input);
  validateMajorClaims(input);
}

function validateExecutionState(context: JudgeValidationContext): void {
  if (context.debateStatus !== DebateStatus.JUDGING) {
    throw new JudgeInputError("Debate status must be JUDGING.");
  }

  if (context.hasExistingJudgmentResult) {
    throw new JudgeInputError("JudgmentResult already exists.");
  }

  for (const turn of context.turns) {
    if (turn.analysisStatus !== DebateTurnAnalysisStatus.COMPLETED) {
      throw new JudgeInputError(
        `DebateTurn analysis is not completed: ${turn.id}.`,
      );
    }
  }

  for (const task of context.factCheckBatchTasks) {
    if (task.status !== FactCheckBatchTaskStatus.COMPLETED) {
      throw new JudgeInputError(
        `FactCheckBatchTask is not completed: ${task.id}.`,
      );
    }
  }
}

function validateParticipants(input: JudgeInput): void {
  for (const component of input.argumentGraph.components) {
    if (component.speakerSide === DebateSide.SIDE_A) {
      if (component.speakerId !== input.debate.sideASpeakerId) {
        throw new JudgeInputError(
          `SIDE_A component speakerId mismatch: ${component.id}.`,
        );
      }
      continue;
    }

    if (component.speakerSide === DebateSide.SIDE_B) {
      if (component.speakerId !== input.debate.sideBSpeakerId) {
        throw new JudgeInputError(
          `SIDE_B component speakerId mismatch: ${component.id}.`,
        );
      }
      continue;
    }

    throw new JudgeInputError(
      `Invalid component speakerSide: ${component.id}.`,
    );
  }
}

function validateComponents(input: JudgeInput): void {
  const componentIds = input.argumentGraph.components.map(
    (component) => component.id,
  );

  if (new Set(componentIds).size !== componentIds.length) {
    throw new JudgeInputError("JudgeInput contains duplicate component IDs.");
  }

  for (const component of input.argumentGraph.components) {
    if (!component.statement.trim()) {
      throw new JudgeInputError(
        `JudgeInput component statement must not be empty: ${component.id}.`,
      );
    }
  }
}

function validateRelations(input: JudgeInput): void {
  const componentIds = new Set(
    input.argumentGraph.components.map((component) => component.id),
  );

  for (const relation of [
    ...input.argumentGraph.argumentalRelations,
    ...input.argumentGraph.interactionalRelations,
  ]) {
    if (
      !componentIds.has(relation.fromComponentId) ||
      !componentIds.has(relation.toComponentId)
    ) {
      throw new JudgeInputError(
        "JudgeInput relation references missing component.",
      );
    }

    if (relation.fromComponentId === relation.toComponentId) {
      throw new JudgeInputError("JudgeInput relation cannot self-reference.");
    }
  }
}

function validateFactCheckResults(input: JudgeInput): void {
  const componentIds = new Set(
    input.argumentGraph.components.map((component) => component.id),
  );
  const resultComponentIds = input.factCheckResults.map(
    (result) => result.componentId,
  );

  if (new Set(resultComponentIds).size !== resultComponentIds.length) {
    throw new JudgeInputError(
      "JudgeInput contains duplicate FactCheckResults.",
    );
  }

  for (const result of input.factCheckResults) {
    if (!componentIds.has(result.componentId)) {
      throw new JudgeInputError(
        `FactCheckResult references missing component: ${result.componentId}.`,
      );
    }

    if (!result.reason.trim()) {
      throw new JudgeInputError(
        `FactCheckResult reason must not be empty: ${result.componentId}.`,
      );
    }
  }

  const resultComponentIdSet = new Set(resultComponentIds);

  for (const component of input.argumentGraph.components) {
    if (
      component.requiresFactCheck &&
      !resultComponentIdSet.has(component.id)
    ) {
      throw new JudgeInputError(
        `FactCheckResult is missing for component: ${component.id}.`,
      );
    }
  }
}

function validateMajorClaims(input: JudgeInput): void {
  const sideAMajorClaimCount = input.argumentGraph.components.filter(
    (component) =>
      component.speakerSide === DebateSide.SIDE_A && component.isMajorClaim,
  ).length;
  const sideBMajorClaimCount = input.argumentGraph.components.filter(
    (component) =>
      component.speakerSide === DebateSide.SIDE_B && component.isMajorClaim,
  ).length;

  if (sideAMajorClaimCount > 1 || sideBMajorClaimCount > 1) {
    throw new JudgeInputError("Each side can have at most one Major Claim.");
  }
}
