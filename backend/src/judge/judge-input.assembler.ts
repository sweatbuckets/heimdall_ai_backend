import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { AssembledJudgeInput } from "./dto/judge.dto";
import { JudgeInputError } from "./errors/judge.errors";
import { ArgumentalRelationEntity } from "../debates/entities/argumental-relation.entity";
import { DebateEntity } from "../debates/entities/debate.entity";
import { FactCheckBatchEntity } from "../debates/entities/fact-check-batch.entity";
import { FactCheckResultEntity } from "../debates/entities/fact-check-result.entity";
import { InteractionalRelationEntity } from "../debates/entities/interactional-relation.entity";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";

@Injectable()
export class JudgeInputAssembler {
  constructor(
    @InjectRepository(DebateEntity)
    private readonly debateRepository: Repository<DebateEntity>,
    @InjectRepository(ArgumentalRelationEntity)
    private readonly argumentalRelationRepository: Repository<ArgumentalRelationEntity>,
    @InjectRepository(InteractionalRelationEntity)
    private readonly interactionalRelationRepository: Repository<InteractionalRelationEntity>,
    @InjectRepository(FactCheckResultEntity)
    private readonly factCheckResultRepository: Repository<FactCheckResultEntity>,
    @InjectRepository(FactCheckBatchEntity)
    private readonly factCheckBatchRepository: Repository<FactCheckBatchEntity>,
    @InjectRepository(JudgmentResultEntity)
    private readonly judgmentResultRepository: Repository<JudgmentResultEntity>,
  ) {}

  async assemble(debateId: string): Promise<AssembledJudgeInput> {
    const debate = await this.debateRepository
      .createQueryBuilder("debate")
      .innerJoinAndSelect("debate.sideASpeaker", "sideASpeaker")
      .innerJoinAndSelect("debate.sideBSpeaker", "sideBSpeaker")
      .leftJoinAndSelect("debate.turns", "turn")
      .leftJoinAndSelect("turn.components", "component")
      .where("debate.id = :debateId", { debateId })
      .orderBy("turn.sequence", "ASC")
      .addOrderBy("component.created_at", "ASC")
      .getOne();

    if (!debate) {
      throw new JudgeInputError(`Debate not found: ${debateId}.`);
    }

    const sortedTurns = [...debate.turns].sort((left, right) => {
      return left.sequence - right.sequence;
    });
    const componentIds = sortedTurns.flatMap((turn) =>
      turn.components.map((component) => component.id),
    );
    const [
      argumentalRelations,
      interactionalRelations,
      factCheckResults,
      factCheckBatches,
      existingJudgmentResult,
    ] = await Promise.all([
      this.findArgumentalRelations(componentIds),
      this.findInteractionalRelations(componentIds),
      this.findFactCheckResults(componentIds),
      this.findFactCheckBatches(debateId),
      this.judgmentResultRepository.findOne({ where: { debateId } }),
    ]);

    return {
      input: {
        debate: {
          id: debate.id,
          topic: debate.topic,
          sideASpeakerId: debate.sideASpeakerId,
          sideASpeakerDisplayName: debate.sideASpeaker.displayName,
          sideBSpeakerId: debate.sideBSpeakerId,
          sideBSpeakerDisplayName: debate.sideBSpeaker.displayName,
          rebuttalQuestionRounds: debate.rebuttalQuestionRounds,
        },
        argumentGraph: {
          components: sortedTurns.flatMap((turn) =>
            turn.components.map((component) => ({
              id: component.id,
              speakerId: turn.speakerId,
              speakerSide: turn.speakerSide,
              phase: turn.phase,
              round: turn.round,
              turnSequence: turn.sequence,
              statement: component.statement,
              isMajorClaim: component.isMajorClaim,
              requiresFactCheck: component.requiresFactCheck,
            })),
          ),
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
        factCheckResults: factCheckResults.map((result) => ({
          componentId: result.componentId,
          status: result.status,
          reason: result.reason,
        })),
      },
      validationContext: {
        debateStatus: debate.status,
        turns: sortedTurns.map((turn) => ({
          id: turn.id,
          analysisStatus: turn.analysisStatus,
        })),
        factCheckBatches: factCheckBatches.map((batch) => ({
          id: batch.id,
          status: batch.status,
        })),
        hasExistingJudgmentResult: Boolean(existingJudgmentResult),
      },
    };
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

  private async findFactCheckResults(
    componentIds: string[],
  ): Promise<FactCheckResultEntity[]> {
    if (componentIds.length === 0) {
      return [];
    }

    return this.factCheckResultRepository.find({
      where: {
        componentId: In(componentIds),
      },
    });
  }

  private async findFactCheckBatches(
    debateId: string,
  ): Promise<FactCheckBatchEntity[]> {
    return this.factCheckBatchRepository.find({ where: { debateId } });
  }
}
