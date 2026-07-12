import { VerificationStatus } from "../../debates/domain/debate.enums";
import {
  FactCheckBatchOutput,
  GroundedEvidenceBundle,
} from "../dto/fact-check-batch.dto";
import { mapFactCheckBatchOutputToEntities } from "./fact-check-result.mapper";

describe("mapFactCheckBatchOutputToEntities", () => {
  it("maps result entities and grounding-metadata sources by sourceIndex", () => {
    const output: FactCheckBatchOutput = {
      results: [
        {
          componentId: "component-1",
          status: VerificationStatus.SUPPORTED,
          reason: "  Supported by the source.  ",
          sourceIndexes: [0],
        },
      ],
    };
    const groundedEvidence: GroundedEvidenceBundle = {
      evidenceText: "Evidence.",
      webSearchQueries: ["query"],
      sources: [
        {
          sourceIndex: 0,
          title: "Official report",
          publisher: "example.gov",
          url: "https://example.gov/report",
        },
      ],
    };
    const checkedAt = new Date("2026-07-11T00:00:00.000Z");

    const mapped = mapFactCheckBatchOutputToEntities(
      "task-1",
      output,
      groundedEvidence,
      checkedAt,
    );

    expect(mapped.results).toHaveLength(1);
    expect(mapped.results[0]).toMatchObject({
      factCheckBatchTaskId: "task-1",
      componentId: "component-1",
      status: VerificationStatus.SUPPORTED,
      reason: "Supported by the source.",
      checkedAt,
    });
    expect(mapped.sources).toHaveLength(1);
    expect(mapped.sources[0]).toMatchObject({
      title: "Official report",
      publisher: "example.gov",
      url: "https://example.gov/report",
    });
  });
});
