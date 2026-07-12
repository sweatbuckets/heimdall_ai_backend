import { VerificationStatus } from "../../debates/domain/debate.enums";
import {
  FactCheckBatchInput,
  FactCheckBatchOutput,
  GroundedEvidenceBundle,
} from "../dto/fact-check-batch.dto";
import { InvalidFactCheckOutputError } from "../errors/fact-check.errors";

export interface FactCheckBatchOutputValidationLimits {
  maxReasonLength: number;
  maxSourcesPerResult: number;
}

const VERIFICATION_STATUSES = new Set<string>(
  Object.values(VerificationStatus),
);

export function validateFactCheckBatchOutput(
  input: FactCheckBatchInput,
  output: FactCheckBatchOutput,
  groundedEvidence: GroundedEvidenceBundle,
  limits: FactCheckBatchOutputValidationLimits,
): void {
  validateOutputShape(output);
  validateComponentIds(input, output);
  validateResults(output, groundedEvidence, limits);
}

function validateOutputShape(output: FactCheckBatchOutput): void {
  if (!Array.isArray(output.results)) {
    throw new InvalidFactCheckOutputError("results must be an array.");
  }
}

function validateComponentIds(
  input: FactCheckBatchInput,
  output: FactCheckBatchOutput,
): void {
  if (output.results.length !== input.targets.length) {
    throw new InvalidFactCheckOutputError(
      "Fact check result count must match input target count.",
    );
  }

  const inputComponentIds = new Set(
    input.targets.map((target) => target.componentId),
  );
  const outputComponentIds = output.results.map((result) => result.componentId);

  if (new Set(outputComponentIds).size !== outputComponentIds.length) {
    throw new InvalidFactCheckOutputError(
      "FactCheckBatchOutput contains duplicate componentIds.",
    );
  }

  for (const componentId of outputComponentIds) {
    if (!inputComponentIds.has(componentId)) {
      throw new InvalidFactCheckOutputError(
        `FactCheckBatchOutput contains unknown componentId: ${componentId}.`,
      );
    }
  }

  for (const componentId of inputComponentIds) {
    if (!outputComponentIds.includes(componentId)) {
      throw new InvalidFactCheckOutputError(
        `FactCheckBatchOutput is missing componentId: ${componentId}.`,
      );
    }
  }
}

function validateResults(
  output: FactCheckBatchOutput,
  groundedEvidence: GroundedEvidenceBundle,
  limits: FactCheckBatchOutputValidationLimits,
): void {
  const sourceIndexes = new Set(
    groundedEvidence.sources.map((source) => source.sourceIndex),
  );

  for (const result of output.results) {
    if (!VERIFICATION_STATUSES.has(result.status)) {
      throw new InvalidFactCheckOutputError(
        `Invalid verification status: ${result.status}.`,
      );
    }

    if (!result.reason.trim()) {
      throw new InvalidFactCheckOutputError(
        `Fact check reason must not be empty: ${result.componentId}.`,
      );
    }

    if (result.reason.length > limits.maxReasonLength) {
      throw new InvalidFactCheckOutputError(
        `Fact check reason exceeds limit: ${result.componentId}.`,
      );
    }

    if (!Array.isArray(result.sourceIndexes)) {
      throw new InvalidFactCheckOutputError(
        `sourceIndexes must be an array: ${result.componentId}.`,
      );
    }

    if (result.sourceIndexes.length > limits.maxSourcesPerResult) {
      throw new InvalidFactCheckOutputError(
        `Fact check source count exceeds limit: ${result.componentId}.`,
      );
    }

    if (new Set(result.sourceIndexes).size !== result.sourceIndexes.length) {
      throw new InvalidFactCheckOutputError(
        `Fact check result contains duplicate sourceIndexes: ${result.componentId}.`,
      );
    }

    for (const sourceIndex of result.sourceIndexes) {
      if (!Number.isInteger(sourceIndex) || !sourceIndexes.has(sourceIndex)) {
        throw new InvalidFactCheckOutputError(
          `Fact check result references invalid sourceIndex: ${result.componentId}.`,
        );
      }
    }
  }
}
