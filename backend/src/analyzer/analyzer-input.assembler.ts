import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { AnalyzeTurnInput, ExistingComponent } from "./dto/analyze-turn.dto";
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
    const currentTurn = await this.debateTurnRepository.findOne({
      where: { id: turnId },
      relations: { debate: true },
    });

    if (!currentTurn) {
      throw new AnalyzeTurnInputError(`DebateTurn not found: ${turnId}.`);
    }

    if (!currentTurn.content.trim()) {
      throw new AnalyzeTurnInputError("DebateTurn content must not be empty.");
    }

    this.validateSpeakerSide(currentTurn);

    const accumulatedTurns = await this.debateTurnRepository.find({
      where: {
        debateId: currentTurn.debateId,
      },
      relations: {
        components: true,
      },
      order: {
        sequence: "ASC",
      },
    });

    const existingComponents = accumulatedTurns
      .filter((turn) => turn.id !== currentTurn.id)
      .flatMap((turn) => this.mapTurnComponents(turn));

    const existingComponentIds = existingComponents.map(
      (component) => component.id,
    );

    const argumentalRelations =
      await this.findArgumentalRelations(existingComponentIds);
    const interactionalRelations =
      await this.findInteractionalRelations(existingComponentIds);

    return {
      debate: {
        id: currentTurn.debate.id,
        topic: currentTurn.debate.topic,
        sideASpeakerId: currentTurn.debate.sideASpeakerId,
        sideBSpeakerId: currentTurn.debate.sideBSpeakerId,
        rebuttalQuestionRounds: currentTurn.debate.rebuttalQuestionRounds,
      },
      currentTurn: {
        id: currentTurn.id,
        speakerId: currentTurn.speakerId,
        speakerSide: currentTurn.speakerSide,
        phase: currentTurn.phase,
        round: currentTurn.round,
        sequence: currentTurn.sequence,
        content: currentTurn.content,
      },
      accumulatedGraph: {
        components: existingComponents,
        argumentalRelations: argumentalRelations.map((relation) => ({
          fromComponentId: relation.fromComponentId,
          toComponentId: relation.toComponentId,
          type: relation.type,
        })),
        interactionalRelations: interactionalRelations.map((relation) => ({
          fromComponentId: relation.fromComponentId,
          toComponentId: relation.toComponentId,
          type: relation.type,
        })),
      },
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
    });
  }
}
