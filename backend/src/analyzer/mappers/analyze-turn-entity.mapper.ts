import { randomUUID } from "node:crypto";
import {
  AnalyzeTurnInput,
  AnalyzeTurnOutput,
  NewComponentLocalKey,
  RelationTargetRef,
} from "../dto/analyze-turn.dto";
import { ArgumentComponentEntity } from "../../debates/entities/argument-component.entity";
import { ArgumentalRelationEntity } from "../../debates/entities/argumental-relation.entity";
import { FactCheckBatchTargetEntity } from "../../debates/entities/fact-check-batch-target.entity";
import { InteractionalRelationEntity } from "../../debates/entities/interactional-relation.entity";

export interface AnalyzeTurnEntityMapping {
  components: Array<Partial<ArgumentComponentEntity>>;
  argumentalRelations: Array<Partial<ArgumentalRelationEntity>>;
  interactionalRelations: Array<Partial<InteractionalRelationEntity>>;
  factCheckTargetComponentIds: string[];
  localKeyToComponentId: Map<NewComponentLocalKey, string>;
}

export function mapAnalyzeTurnOutputToEntities(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
): AnalyzeTurnEntityMapping {
  const localKeyToComponentId = new Map<NewComponentLocalKey, string>();

  for (const component of output.newComponents) {
    localKeyToComponentId.set(component.localKey, randomUUID());
  }

  const components = output.newComponents.map((component) => {
    const componentId = localKeyToComponentId.get(component.localKey);

    if (!componentId) {
      throw new Error(`Missing mapped component id: ${component.localKey}.`);
    }

    return {
      id: componentId,
      turnId: input.currentTurn.id,
      isMajorClaim: component.isMajorClaim,
      statement: component.statement.trim(),
      requiresFactCheck: component.requiresFactCheck,
    };
  });

  const argumentalRelations = output.newArgumentalRelations.map((relation) => ({
    id: randomUUID(),
    fromComponentId: resolveNewComponentId(
      relation.from.localKey,
      localKeyToComponentId,
    ),
    toComponentId: resolveRelationTargetId(relation.to, localKeyToComponentId),
    type: relation.type,
  }));

  const interactionalRelations = output.newInteractionalRelations.map(
    (relation) => ({
      id: randomUUID(),
      fromComponentId: resolveNewComponentId(
        relation.from.localKey,
        localKeyToComponentId,
      ),
      toComponentId: resolveRelationTargetId(
        relation.to,
        localKeyToComponentId,
      ),
      type: relation.type,
    }),
  );

  const factCheckTargetComponentIds = output.newComponents
    .filter((component) => component.requiresFactCheck)
    .map((component) =>
      resolveNewComponentId(component.localKey, localKeyToComponentId),
    );

  return {
    components,
    argumentalRelations,
    interactionalRelations,
    factCheckTargetComponentIds,
    localKeyToComponentId,
  };
}

export function mapFactCheckTargets(
  factCheckBatchTaskId: string,
  componentIds: string[],
): Array<Partial<FactCheckBatchTargetEntity>> {
  return componentIds.map((componentId) => ({
    id: randomUUID(),
    factCheckBatchTaskId,
    componentId,
  }));
}

function resolveRelationTargetId(
  ref: RelationTargetRef,
  localKeyToComponentId: Map<NewComponentLocalKey, string>,
): string {
  if (ref.source === "EXISTING") {
    return ref.componentId;
  }

  return resolveNewComponentId(ref.localKey, localKeyToComponentId);
}

function resolveNewComponentId(
  localKey: NewComponentLocalKey,
  localKeyToComponentId: Map<NewComponentLocalKey, string>,
): string {
  const componentId = localKeyToComponentId.get(localKey);

  if (!componentId) {
    throw new Error(`Missing mapped component id: ${localKey}.`);
  }

  return componentId;
}
