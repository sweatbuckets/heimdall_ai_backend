import { VerificationStatus } from "../../debates/domain/debate.enums";

export interface FactCheckTarget {
  componentId: string;
  statement: string;
}

export interface FactCheckBatchInput {
  debate: {
    id: string;
    topic: string;
  };
  turn: {
    id: string;
    sequence: number;
  };
  targets: FactCheckTarget[];
}

export interface GroundedSource {
  sourceIndex: number;
  title: string;
  publisher: string;
  url: string;
}

export interface GroundedEvidenceBundle {
  evidenceText: string;
  webSearchQueries: string[];
  sources: GroundedSource[];
}

export interface FactCheckResultOutput {
  componentId: string;
  status: VerificationStatus;
  reason: string;
  sourceIndexes: number[];
}

export interface FactCheckBatchOutput {
  results: FactCheckResultOutput[];
}
