import {
  ArgumentalRelationType,
  DebatePhase,
  DebateSide,
  InteractionalRelationType,
} from "../../debates/domain/debate.enums";

export type ExistingGraphItem =
  | {
      kind: "COMPONENT";
      id: string;
      turnId: string;
      speakerId: string;
      speakerSide: DebateSide;
      phase: DebatePhase;
      round: number;
      turnSequence: number;
      statement: string;
      isMajorClaim: boolean;
    }
  | {
      kind: "ARGUMENTAL_RELATION";
      id: string;
      fromComponentId: string;
      toComponentId: string;
      type: ArgumentalRelationType;
    }
  | {
      kind: "INTERACTIONAL_RELATION";
      id: string;
      fromComponentId: string;
      toComponentId: string;
      type: InteractionalRelationType;
    };

export interface ExistingComponent {
  id: string;
  turnId: string;
  speakerId: string;
  speakerSide: DebateSide;
  phase: DebatePhase;
  round: number;
  turnSequence: number;
  statement: string;
  isMajorClaim: boolean;
}

export interface ExistingArgumentalRelation {
  fromComponentId: string;
  toComponentId: string;
  type: ArgumentalRelationType;
}

export interface ExistingInteractionalRelation {
  fromComponentId: string;
  toComponentId: string;
  type: InteractionalRelationType;
}

export interface AnalyzeTurnInput {
  debate: {
    id: string;
    topic: string;
    sideASpeakerId: string;
    sideBSpeakerId: string;
    rebuttalQuestionRounds: number;
  };
  accumulatedGraph: {
    graphItems: ExistingGraphItem[];
  };
  currentTurns: Array<{
    id: string;
    speakerId: string;
    speakerSide: DebateSide;
    phase: DebatePhase;
    round: number;
    sequence: number;
    content: string;
  }>;
}

export type NewComponentLocalKey = `NEW_${number}`;

export interface NewComponentRef {
  source: "NEW";
  localKey: NewComponentLocalKey;
}

export interface ExistingComponentRef {
  source: "EXISTING";
  componentId: string;
}

export type RelationTargetRef = NewComponentRef | ExistingComponentRef;

export interface NewComponent {
  localKey: NewComponentLocalKey;
  turnId: string;
  statement: string;
  isMajorClaim: boolean;
  requiresFactCheck: boolean;
}

export interface NewArgumentalRelation {
  from: NewComponentRef;
  to: RelationTargetRef;
  type: ArgumentalRelationType;
}

export interface NewInteractionalRelation {
  from: NewComponentRef;
  to: RelationTargetRef;
  type: InteractionalRelationType;
}

export interface AnalyzeTurnOutput {
  newComponents: NewComponent[];
  newArgumentalRelations: NewArgumentalRelation[];
  newInteractionalRelations: NewInteractionalRelation[];
}
