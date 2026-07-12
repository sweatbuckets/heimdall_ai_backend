import { VerificationStatus } from "../../debates/domain/debate.enums";
import {
  FactCheckBatchInput,
  FactCheckBatchOutput,
  GroundedEvidenceBundle,
} from "../dto/fact-check-batch.dto";
import { InvalidFactCheckOutputError } from "../errors/fact-check.errors";
import { validateFactCheckBatchOutput } from "./fact-check-batch-output.validator";

describe("validateFactCheckBatchOutput", () => {
  const input: FactCheckBatchInput = {
    debate: {
      id: "debate-1",
      topic: "Should attendance count toward grades?",
    },
    turn: {
      id: "turn-1",
      sequence: 1,
    },
    targets: [
      {
        componentId: "component-1",
        statement: "Attendance improves final grades.",
      },
      {
        componentId: "component-2",
        statement: "Attendance policies reduce dropout rates.",
      },
    ],
  };
  const groundedEvidence: GroundedEvidenceBundle = {
    evidenceText: "Grounded evidence.",
    webSearchQueries: ["attendance grades research"],
    sources: [
      {
        sourceIndex: 0,
        title: "Study",
        publisher: "example.edu",
        url: "https://example.edu/study",
      },
      {
        sourceIndex: 1,
        title: "Report",
        publisher: "example.org",
        url: "https://example.org/report",
      },
    ],
  };
  const limits = {
    maxReasonLength: 2000,
    maxSourcesPerResult: 5,
  };

  it("accepts one valid result for every input target", () => {
    const output: FactCheckBatchOutput = {
      results: [
        {
          componentId: "component-1",
          status: VerificationStatus.PARTIALLY_SUPPORTED,
          reason: "Evidence is mixed.",
          sourceIndexes: [0],
        },
        {
          componentId: "component-2",
          status: VerificationStatus.INSUFFICIENT_EVIDENCE,
          reason: "Available evidence is insufficient.",
          sourceIndexes: [1],
        },
      ],
    };

    expect(() =>
      validateFactCheckBatchOutput(input, output, groundedEvidence, limits),
    ).not.toThrow();
  });

  it("rejects missing input component results", () => {
    const output: FactCheckBatchOutput = {
      results: [
        {
          componentId: "component-1",
          status: VerificationStatus.SUPPORTED,
          reason: "Supported.",
          sourceIndexes: [0],
        },
      ],
    };

    expect(() =>
      validateFactCheckBatchOutput(input, output, groundedEvidence, limits),
    ).toThrow(InvalidFactCheckOutputError);
  });

  it("rejects duplicate component results", () => {
    const output: FactCheckBatchOutput = {
      results: [
        {
          componentId: "component-1",
          status: VerificationStatus.SUPPORTED,
          reason: "Supported.",
          sourceIndexes: [0],
        },
        {
          componentId: "component-1",
          status: VerificationStatus.CONTRADICTED,
          reason: "Contradicted.",
          sourceIndexes: [1],
        },
      ],
    };

    expect(() =>
      validateFactCheckBatchOutput(input, output, groundedEvidence, limits),
    ).toThrow(InvalidFactCheckOutputError);
  });

  it("rejects source indexes not extracted from grounding metadata", () => {
    const output: FactCheckBatchOutput = {
      results: [
        {
          componentId: "component-1",
          status: VerificationStatus.SUPPORTED,
          reason: "Supported.",
          sourceIndexes: [0],
        },
        {
          componentId: "component-2",
          status: VerificationStatus.SUPPORTED,
          reason: "Supported.",
          sourceIndexes: [99],
        },
      ],
    };

    expect(() =>
      validateFactCheckBatchOutput(input, output, groundedEvidence, limits),
    ).toThrow(InvalidFactCheckOutputError);
  });
});
