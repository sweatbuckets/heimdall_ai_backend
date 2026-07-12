import { FactCheckBatchInput } from "../dto/fact-check-batch.dto";
import { FactCheckInputError } from "../errors/fact-check.errors";

export interface FactCheckBatchInputValidationLimits {
  maxTargetsPerBatch: number;
}

export function validateFactCheckBatchInput(
  input: FactCheckBatchInput,
  limits: FactCheckBatchInputValidationLimits,
): void {
  if (!input.targets.length) {
    throw new FactCheckInputError("FactCheckBatchInput must include targets.");
  }

  if (input.targets.length > limits.maxTargetsPerBatch) {
    throw new FactCheckInputError(
      `Fact check target count exceeds limit: ${limits.maxTargetsPerBatch}.`,
    );
  }

  const componentIds = input.targets.map((target) => target.componentId);

  if (new Set(componentIds).size !== componentIds.length) {
    throw new FactCheckInputError(
      "FactCheckBatchInput contains duplicate targets.",
    );
  }

  for (const target of input.targets) {
    if (!target.componentId.trim()) {
      throw new FactCheckInputError(
        "Fact check target componentId is required.",
      );
    }

    if (!target.statement.trim()) {
      throw new FactCheckInputError(
        `Fact check target statement must not be empty: ${target.componentId}.`,
      );
    }
  }
}
