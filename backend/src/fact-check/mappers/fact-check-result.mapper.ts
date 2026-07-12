import { randomUUID } from "node:crypto";
import {
  FactCheckBatchOutput,
  GroundedEvidenceBundle,
} from "../dto/fact-check-batch.dto";
import { FactCheckResultEntity } from "../../debates/entities/fact-check-result.entity";
import { FactCheckSourceEntity } from "../../debates/entities/fact-check-source.entity";

export interface FactCheckResultEntityMapping {
  results: Array<Partial<FactCheckResultEntity>>;
  sources: Array<Partial<FactCheckSourceEntity>>;
}

export function mapFactCheckBatchOutputToEntities(
  factCheckBatchTaskId: string,
  output: FactCheckBatchOutput,
  groundedEvidence: GroundedEvidenceBundle,
  checkedAt: Date,
): FactCheckResultEntityMapping {
  const sourcesByIndex = new Map(
    groundedEvidence.sources.map((source) => [source.sourceIndex, source]),
  );
  const results: Array<Partial<FactCheckResultEntity>> = [];
  const sources: Array<Partial<FactCheckSourceEntity>> = [];

  for (const result of output.results) {
    const factCheckResultId = randomUUID();

    results.push({
      id: factCheckResultId,
      factCheckBatchTaskId,
      componentId: result.componentId,
      status: result.status,
      reason: result.reason.trim(),
      checkedAt,
    });

    for (const sourceIndex of result.sourceIndexes) {
      const groundedSource = sourcesByIndex.get(sourceIndex);

      if (!groundedSource) {
        throw new Error(`Missing grounded source index: ${sourceIndex}.`);
      }

      sources.push({
        id: randomUUID(),
        factCheckResultId,
        title: groundedSource.title,
        publisher: groundedSource.publisher,
        url: groundedSource.url,
      });
    }
  }

  return { results, sources };
}
