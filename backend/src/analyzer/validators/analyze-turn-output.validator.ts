import {
  ArgumentalRelationType,
  DebatePhase,
  InteractionalRelationType,
} from "../../debates/domain/debate.enums";
import {
  AnalyzeTurnInput,
  AnalyzeTurnOutput,
  ExistingComponentRef,
  NewComponentRef,
  RelationTargetRef,
} from "../dto/analyze-turn.dto";
import {
  DEFAULT_MAX_COMPONENT_STATEMENT_LENGTH,
  DEFAULT_MAX_COMPONENTS_PER_TURN,
  DEFAULT_MAX_FACT_CHECK_TARGETS_PER_TURN,
  NEW_COMPONENT_LOCAL_KEY_PATTERN,
} from "../constants";
import { InvalidAnalyzeTurnOutputError } from "../errors/analyzer.errors";
import { EMPTY_DEBATE_TURN_CONTENT } from "../../debates/debate-turn-content.constants";

export interface AnalyzeTurnValidationLimits {
  maxComponentsPerTurn: number;
  maxFactCheckTargetsPerTurn: number;
  maxComponentStatementLength: number;
}

export const DEFAULT_ANALYZE_TURN_VALIDATION_LIMITS: AnalyzeTurnValidationLimits =
  {
    maxComponentsPerTurn: DEFAULT_MAX_COMPONENTS_PER_TURN,
    maxFactCheckTargetsPerTurn: DEFAULT_MAX_FACT_CHECK_TARGETS_PER_TURN,
    maxComponentStatementLength: DEFAULT_MAX_COMPONENT_STATEMENT_LENGTH,
  };

export function validateAnalyzeTurnOutput(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
  limits: AnalyzeTurnValidationLimits = DEFAULT_ANALYZE_TURN_VALIDATION_LIMITS,
): void {
  validateOutputShape(output);
  validateComponentTurnIds(input, output);
  validateEmptyTurns(input, output);
  validateOutputSize(output, limits);
  validateLocalKeys(output);
  validateReferences(input, output);
  validateRelationSources(output);
  validateSelfReferences(output);
  validateDuplicateRelations(output);
  validateConflictingArgumentalRelations(output);
  validateConflictingInteractionalRelations(output);
  validateStatements(output, limits);
  validateMajorClaims(input, output);
}

function validateOutputShape(output: AnalyzeTurnOutput): void {
  if (!Array.isArray(output.newComponents)) {
    throw new InvalidAnalyzeTurnOutputError("newComponents must be an array.");
  }

  if (!Array.isArray(output.newArgumentalRelations)) {
    throw new InvalidAnalyzeTurnOutputError(
      "newArgumentalRelations must be an array.",
    );
  }

  if (!Array.isArray(output.newInteractionalRelations)) {
    throw new InvalidAnalyzeTurnOutputError(
      "newInteractionalRelations must be an array.",
    );
  }
}

function validateOutputSize(
  output: AnalyzeTurnOutput,
  limits: AnalyzeTurnValidationLimits,
): void {
  const componentsByTurn = new Map<string, typeof output.newComponents>();

  for (const component of output.newComponents) {
    const components = componentsByTurn.get(component.turnId) ?? [];
    components.push(component);
    componentsByTurn.set(component.turnId, components);
  }

  for (const [turnId, components] of componentsByTurn) {
    if (components.length > limits.maxComponentsPerTurn) {
      throw new InvalidAnalyzeTurnOutputError(
        `Component count exceeds per-turn limit for ${turnId}: ${limits.maxComponentsPerTurn}.`,
      );
    }

    const factCheckTargetCount = components.filter(
      (component) => component.requiresFactCheck,
    ).length;

    if (factCheckTargetCount > limits.maxFactCheckTargetsPerTurn) {
      throw new InvalidAnalyzeTurnOutputError(
        `Fact check target count exceeds per-turn limit for ${turnId}: ${limits.maxFactCheckTargetsPerTurn}.`,
      );
    }
  }
}

function validateComponentTurnIds(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
): void {
  const currentTurnIds = new Set(input.currentTurns.map((turn) => turn.id));

  for (const component of output.newComponents) {
    if (!currentTurnIds.has(component.turnId)) {
      throw new InvalidAnalyzeTurnOutputError(
        `Component references unknown current turn: ${component.turnId}.`,
      );
    }
  }
}

function validateEmptyTurns(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
): void {
  const emptyTurnIds = new Set(
    input.currentTurns
      .filter((turn) => turn.content.trim() === EMPTY_DEBATE_TURN_CONTENT)
      .map((turn) => turn.id),
  );

  for (const component of output.newComponents) {
    if (emptyTurnIds.has(component.turnId)) {
      throw new InvalidAnalyzeTurnOutputError(
        `No component may be created for an empty debate turn: ${component.turnId}.`,
      );
    }
  }
}

function validateLocalKeys(output: AnalyzeTurnOutput): void {
  const localKeys = output.newComponents.map(({ localKey }) => localKey);

  for (const localKey of localKeys) {
    if (!NEW_COMPONENT_LOCAL_KEY_PATTERN.test(localKey)) {
      throw new InvalidAnalyzeTurnOutputError(
        `Invalid new component localKey: ${localKey}.`,
      );
    }
  }

  if (new Set(localKeys).size !== localKeys.length) {
    throw new InvalidAnalyzeTurnOutputError(
      "AnalyzeTurnOutput contains duplicate localKeys.",
    );
  }
}

function validateReferences(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
): void {
  const newLocalKeys = new Set(
    output.newComponents.map((component) => component.localKey),
  );
  const existingComponentIds = new Set(
    input.accumulatedGraph.graphItems
      .filter((item) => item.kind === "COMPONENT")
      .map((component) => component.id),
  );

  for (const ref of collectRelationRefs(output)) {
    if (ref.source === "NEW" && !newLocalKeys.has(ref.localKey)) {
      throw new InvalidAnalyzeTurnOutputError(
        `Relation references unknown NEW component: ${ref.localKey}.`,
      );
    }

    if (
      ref.source === "EXISTING" &&
      !existingComponentIds.has(ref.componentId)
    ) {
      throw new InvalidAnalyzeTurnOutputError(
        `Relation references unknown EXISTING component: ${ref.componentId}.`,
      );
    }
  }
}

function validateRelationSources(output: AnalyzeTurnOutput): void {
  for (const relation of [
    ...output.newArgumentalRelations,
    ...output.newInteractionalRelations,
  ]) {
    if (relation.from.source !== "NEW") {
      throw new InvalidAnalyzeTurnOutputError(
        "Every new relation must start from a NEW component.",
      );
    }
  }
}

function validateSelfReferences(output: AnalyzeTurnOutput): void {
  for (const relation of [
    ...output.newArgumentalRelations,
    ...output.newInteractionalRelations,
  ]) {
    if (
      normalizeComponentRef(relation.from) ===
      normalizeComponentRef(relation.to)
    ) {
      throw new InvalidAnalyzeTurnOutputError(
        "Relation cannot reference the same component as from and to.",
      );
    }
  }
}

function validateDuplicateRelations(output: AnalyzeTurnOutput): void {
  const keys = [
    ...output.newArgumentalRelations.map((relation) =>
      buildRelationKey("ARGUMENTAL", relation.from, relation.to, relation.type),
    ),
    ...output.newInteractionalRelations.map((relation) =>
      buildRelationKey(
        "INTERACTIONAL",
        relation.from,
        relation.to,
        relation.type,
      ),
    ),
  ];

  if (new Set(keys).size !== keys.length) {
    throw new InvalidAnalyzeTurnOutputError(
      "AnalyzeTurnOutput contains duplicate relations.",
    );
  }
}

function validateConflictingArgumentalRelations(
  output: AnalyzeTurnOutput,
): void {
  const directionalPairs = new Map<string, Set<ArgumentalRelationType>>();

  for (const relation of output.newArgumentalRelations) {
    const key = buildDirectionalPairKey(relation.from, relation.to);
    const types =
      directionalPairs.get(key) ?? new Set<ArgumentalRelationType>();
    types.add(relation.type);
    directionalPairs.set(key, types);
  }

  for (const types of directionalPairs.values()) {
    if (
      types.has(ArgumentalRelationType.SUPPORTS) &&
      types.has(ArgumentalRelationType.ATTACKS)
    ) {
      throw new InvalidAnalyzeTurnOutputError(
        "SUPPORTS and ATTACKS cannot exist for the same from/to pair.",
      );
    }
  }
}

function validateConflictingInteractionalRelations(
  output: AnalyzeTurnOutput,
): void {
  const directionalPairs = new Map<string, Set<InteractionalRelationType>>();

  for (const relation of output.newInteractionalRelations) {
    const key = buildDirectionalPairKey(relation.from, relation.to);
    const types =
      directionalPairs.get(key) ?? new Set<InteractionalRelationType>();
    types.add(relation.type);
    directionalPairs.set(key, types);
  }

  for (const types of directionalPairs.values()) {
    if (
      types.has(InteractionalRelationType.QUESTIONS) &&
      types.has(InteractionalRelationType.ANSWERS)
    ) {
      throw new InvalidAnalyzeTurnOutputError(
        "QUESTIONS and ANSWERS cannot exist for the same from/to pair.",
      );
    }
  }
}

function validateStatements(
  output: AnalyzeTurnOutput,
  limits: AnalyzeTurnValidationLimits,
): void {
  for (const component of output.newComponents) {
    if (!component.statement.trim()) {
      throw new InvalidAnalyzeTurnOutputError(
        `Component statement must not be empty: ${component.localKey}.`,
      );
    }

    if (component.statement.length > limits.maxComponentStatementLength) {
      throw new InvalidAnalyzeTurnOutputError(
        `Component statement exceeds limit: ${component.localKey}.`,
      );
    }
  }
}

function validateMajorClaims(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
): void {
  const newMajorClaims = output.newComponents.filter(
    (component) => component.isMajorClaim,
  );

  for (const turn of input.currentTurns) {
    const turnMajorClaims = newMajorClaims.filter(
      (component) => component.turnId === turn.id,
    );

    if (turnMajorClaims.length > 0 && turn.phase !== DebatePhase.OPENING) {
      throw new InvalidAnalyzeTurnOutputError(
        "Major Claim is only allowed in OPENING phase.",
      );
    }

    const existingSpeakerMajorClaimCount =
      input.accumulatedGraph.graphItems
        .filter((item) => item.kind === "COMPONENT")
        .filter(
        (component) =>
          component.speakerId === turn.speakerId && component.isMajorClaim,
        ).length;

    if (existingSpeakerMajorClaimCount + turnMajorClaims.length > 1) {
      throw new InvalidAnalyzeTurnOutputError(
        "A speaker can have at most one Major Claim in a debate.",
      );
    }
  }
}

function collectRelationRefs(
  output: AnalyzeTurnOutput,
): Array<NewComponentRef | ExistingComponentRef> {
  return [
    ...output.newArgumentalRelations.flatMap((relation) => [
      relation.from,
      relation.to,
    ]),
    ...output.newInteractionalRelations.flatMap((relation) => [
      relation.from,
      relation.to,
    ]),
  ];
}

function normalizeComponentRef(ref: RelationTargetRef): string {
  if (ref.source === "NEW") {
    return `NEW:${ref.localKey}`;
  }

  return `EXISTING:${ref.componentId}`;
}

function buildRelationKey(
  relationKind: "ARGUMENTAL" | "INTERACTIONAL",
  from: NewComponentRef,
  to: RelationTargetRef,
  type: string,
): string {
  return [
    relationKind,
    normalizeComponentRef(from),
    normalizeComponentRef(to),
    type,
  ].join("|");
}

function buildDirectionalPairKey(
  from: NewComponentRef,
  to: RelationTargetRef,
): string {
  return [normalizeComponentRef(from), normalizeComponentRef(to)].join("|");
}
