import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThan, Repository } from "typeorm";
import {
  AnalyzeTurnInput,
  ExistingComponent,
  ExistingGraphItem,
} from "./dto/analyze-turn.dto";
import { AnalyzeTurnInputError } from "./errors/analyzer.errors";
import { DebateSide } from "../debates/domain/debate.enums";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { ArgumentalRelationEntity } from "../debates/entities/argumental-relation.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { InteractionalRelationEntity } from "../debates/entities/interactional-relation.entity";

@Injectable()
export class AnalyzerInputAssembler {
  constructor(
    @InjectRepository(DebateTurnEntity)
    private readonly debateTurnRepository: Repository<DebateTurnEntity>,
    @InjectRepository(ArgumentalRelationEntity)
    private readonly argumentalRelationRepository: Repository<ArgumentalRelationEntity>,
    @InjectRepository(InteractionalRelationEntity)
    private readonly interactionalRelationRepository: Repository<InteractionalRelationEntity>,
  ) {}

  async assemble(turnId: string): Promise<AnalyzeTurnInput> {
    const requestedTurn = await this.debateTurnRepository.findOne({
      where: { id: turnId },
      relations: { debate: true },
    });

    if (!requestedTurn) {
      throw new AnalyzeTurnInputError(`DebateTurn not found: ${turnId}.`);
    }

    const currentTurns = await this.debateTurnRepository.find({
      where: {
        debateId: requestedTurn.debateId,
        phase: requestedTurn.phase,
        round: requestedTurn.round,
      },
      relations: { debate: true },
      order: { sequence: "ASC" },
    });

    if (currentTurns.length !== 2) {
      throw new AnalyzeTurnInputError(
        `A debate round must contain exactly two turns: ${requestedTurn.phase}/${requestedTurn.round}.`,
      );
    }

    if (new Set(currentTurns.map((turn) => turn.speakerSide)).size !== 2) {
      throw new AnalyzeTurnInputError(
        "A debate round must contain one turn from each side.",
      );
    }

    for (const currentTurn of currentTurns) {
      if (!currentTurn.content.trim()) {
        throw new AnalyzeTurnInputError(
          `DebateTurn content must not be empty: ${currentTurn.id}.`,
        );
      }
      this.validateSpeakerSide(currentTurn);
    }

    const firstSequence = currentTurns[0].sequence;

    const accumulatedTurns = await this.debateTurnRepository.find({
      where: {
        debateId: requestedTurn.debateId,
        sequence: LessThan(firstSequence),
      },
      relations: {
        components: true,
      },
      order: {
        sequence: "ASC",
      },
    });

    // Keep the graph serialization deterministic so identical history shares
    // the longest possible prompt prefix across Analyzer requests.
    const existingComponents = accumulatedTurns
      .flatMap((turn) => this.mapTurnComponents(turn))
      .sort(
        (left, right) =>
          left.turnSequence - right.turnSequence ||
          left.id.localeCompare(right.id),
      );

    const existingComponentIds = existingComponents.map(
      (component) => component.id,
    );

    const argumentalRelations =
      await this.findArgumentalRelations(existingComponentIds);
    const interactionalRelations =
      await this.findInteractionalRelations(existingComponentIds);
    const graphItemsWithCreatedAt = [
      ...existingComponents.map((component) => ({
        kind: "COMPONENT" as const,
        ...component,
        createdAt:
          accumulatedTurns
            .find((turn) => turn.id === component.turnId)
            ?.components.find((candidate) => candidate.id === component.id)
            ?.createdAt.toISOString() ?? "",
      })),
      ...argumentalRelations.map((relation) => ({
        kind: "ARGUMENTAL_RELATION" as const,
        id: relation.id,
        fromComponentId: relation.fromComponentId,
        toComponentId: relation.toComponentId,
        type: relation.type,
        createdAt: relation.createdAt.toISOString(),
      })),
      ...interactionalRelations.map((relation) => ({
        kind: "INTERACTIONAL_RELATION" as const,
        id: relation.id,
        fromComponentId: relation.fromComponentId,
        toComponentId: relation.toComponentId,
        type: relation.type,
        createdAt: relation.createdAt.toISOString(),
      })),
    ].sort((left, right) => {
      return (
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    });
    const graphItems: ExistingGraphItem[] = graphItemsWithCreatedAt.map(
      ({ createdAt: _createdAt, ...item }) => item,
    );

    return {
      debate: {
        id: requestedTurn.debate.id,
        topic: requestedTurn.debate.topic,
        sideASpeakerId: requestedTurn.debate.sideASpeakerId,
        sideBSpeakerId: requestedTurn.debate.sideBSpeakerId,
        rebuttalQuestionRounds: requestedTurn.debate.rebuttalQuestionRounds,
      },
      accumulatedGraph: {
        graphItems,
      },
      currentTurns: currentTurns.map((currentTurn) => ({
        id: currentTurn.id,
        speakerId: currentTurn.speakerId,
        speakerSide: currentTurn.speakerSide,
        phase: currentTurn.phase,
        round: currentTurn.round,
        sequence: currentTurn.sequence,
        content: currentTurn.content,
      })),
    };
  }

  private validateSpeakerSide(turn: DebateTurnEntity): void {
    const expectedSpeakerId =
      turn.speakerSide === DebateSide.SIDE_A
        ? turn.debate.sideASpeakerId
        : turn.debate.sideBSpeakerId;

    if (turn.speakerId !== expectedSpeakerId) {
      throw new AnalyzeTurnInputError(
        "DebateTurn speakerId does not match speakerSide.",
      );
    }
  }

  private mapTurnComponents(turn: DebateTurnEntity): ExistingComponent[] {
    return turn.components.map((component: ArgumentComponentEntity) => ({
      id: component.id,
      turnId: component.turnId,
      speakerId: turn.speakerId,
      speakerSide: turn.speakerSide,
      phase: turn.phase,
      round: turn.round,
      turnSequence: turn.sequence,
      statement: component.statement,
      isMajorClaim: component.isMajorClaim,
    }));
  }

  private async findArgumentalRelations(
    componentIds: string[],
  ): Promise<ArgumentalRelationEntity[]> {
    if (componentIds.length === 0) {
      return [];
    }

    return this.argumentalRelationRepository.find({
      where: {
        fromComponentId: In(componentIds),
        toComponentId: In(componentIds),
      },
      order: { createdAt: "ASC", id: "ASC" },
    });
  }

  private async findInteractionalRelations(
    componentIds: string[],
  ): Promise<InteractionalRelationEntity[]> {
    if (componentIds.length === 0) {
      return [];
    }

    return this.interactionalRelationRepository.find({
      where: {
        fromComponentId: In(componentIds),
        toComponentId: In(componentIds),
      },
      order: { createdAt: "ASC", id: "ASC" },
    });
  }
}
