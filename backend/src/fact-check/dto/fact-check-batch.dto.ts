import {
  DebatePhase,
  DebateSide,
  VerificationStatus,
} from "../../debates/domain/debate.enums";

export interface FactCheckTarget {
  componentId: string;
  statement: string;
  turnId: string;
  sequence: number;
  speakerSide: DebateSide;
}

export interface FactCheckBatchInput {
  debate: {
    id: string;
    topic: string;
  };
  round: {
    phase: DebatePhase;
    number: number;
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
