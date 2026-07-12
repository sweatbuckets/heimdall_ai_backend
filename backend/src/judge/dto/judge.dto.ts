import {
  ArgumentalRelationType,
  DebatePhase,
  DebateSide,
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchTaskStatus,
  InteractionalRelationType,
  VerificationStatus,
} from "../../debates/domain/debate.enums";

export interface JudgeComponent {
  id: string;
  speakerId: string;
  speakerSide: DebateSide;
  phase: DebatePhase;
  round: number;
  turnSequence: number;
  statement: string;
  isMajorClaim: boolean;
  requiresFactCheck: boolean;
}

export interface JudgeArgumentalRelation {
  fromComponentId: string;
  toComponentId: string;
  type: ArgumentalRelationType;
}

export interface JudgeInteractionalRelation {
  fromComponentId: string;
  toComponentId: string;
  type: InteractionalRelationType;
}

export interface JudgeFactCheckResult {
  componentId: string;
  status: VerificationStatus;
  reason: string;
}

export interface JudgeInput {
  debate: {
    id: string;
    topic: string;
    sideASpeakerId: string;
    sideBSpeakerId: string;
    rebuttalQuestionRounds: number;
  };
  argumentGraph: {
    components: JudgeComponent[];
    argumentalRelations: JudgeArgumentalRelation[];
    interactionalRelations: JudgeInteractionalRelation[];
  };
  factCheckResults: JudgeFactCheckResult[];
}

export interface JudgeValidationTurn {
  id: string;
  analysisStatus: DebateTurnAnalysisStatus;
}

export interface JudgeValidationFactCheckBatchTask {
  id: string;
  status: FactCheckBatchTaskStatus;
}

export interface JudgeValidationContext {
  debateStatus: DebateStatus;
  turns: JudgeValidationTurn[];
  factCheckBatchTasks: JudgeValidationFactCheckBatchTask[];
  hasExistingJudgmentResult: boolean;
}

export interface AssembledJudgeInput {
  input: JudgeInput;
  validationContext: JudgeValidationContext;
}

export interface JudgeOutput {
  sideAArgumentationScore: number;
  sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;
  sideBArgumentationScore: number;
  sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;
  overallReason: string;
  sideAFeedback: string;
  sideBFeedback: string;
}
