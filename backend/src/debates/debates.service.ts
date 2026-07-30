import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { MemberEntity } from "../members/entities/member.entity";
import { DebatePhase, DebateSide, DebateStatus } from "./domain/debate.enums";
import {
  CreateDebateRequest,
  DebateDetailDto,
  DebateDto,
  DebateResultDto,
} from "./dto/debate.dto";
import { DebateEntity } from "./entities/debate.entity";
import { DebateTurnEntity } from "./entities/debate-turn.entity";
import { JudgmentResultEntity } from "./entities/judgment-result.entity";
import { mapJudgmentResultResponse } from "../judge/dto/judgment-result-response.dto";
import { JudgeReadinessService } from "../judge/judge-readiness.service";

@Injectable()
export class DebatesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly judgeReadinessService: JudgeReadinessService,
  ) {}

  async createDebate(input: CreateDebateRequest): Promise<DebateDto> {
    await this.assertDebateSpeakersExist(input);

    const id = randomUUID();

    await this.dataSource.getRepository(DebateEntity).insert({
      id,
      topic: input.topic,
      sideASpeakerId: input.sideASpeakerId,
      sideBSpeakerId: input.sideBSpeakerId,
      rebuttalQuestionRounds: input.rebuttalQuestionRounds,
      status: DebateStatus.READY,
    });

    return this.getDebate(id);
  }

  async listDebates(status?: DebateStatus): Promise<DebateDto[]> {
    const debates = await this.dataSource.getRepository(DebateEntity).find({
      where: status ? { status } : {},
      order: { createdAt: "DESC" },
      take: 50,
    });

    return debates.map(mapDebateToDto);
  }

  async getDebate(id: string): Promise<DebateDto> {
    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: { id },
    });

    if (!debate) {
      throw new NotFoundException(`Debate not found: ${id}.`);
    }

    return mapDebateToDto(debate);
  }

  async getDebateDetail(id: string): Promise<DebateDetailDto> {
    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: { id },
    });

    if (!debate) {
      throw new NotFoundException(`Debate not found: ${id}.`);
    }

    const turns = await this.dataSource.getRepository(DebateTurnEntity).find({
      where: { debateId: id },
      order: { sequence: "ASC" },
    });

    return {
      ...mapDebateToDto(debate),
      turns: turns.map((turn) => ({
        id: turn.id,
        debateId: turn.debateId,
        speakerId: turn.speakerId,
        speakerSide: turn.speakerSide,
        phase: turn.phase,
        round: turn.round,
        sequence: turn.sequence,
        content: turn.content,
        createdAt: turn.createdAt.toISOString(),
      })),
    };
  }

  async getDebateResult(id: string): Promise<DebateResultDto> {
    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: { id },
    });

    if (!debate) {
      throw new NotFoundException(`Debate not found: ${id}.`);
    }

    const judgmentResult = await this.dataSource
      .getRepository(JudgmentResultEntity)
      .findOne({
        where: { debateId: id },
      });

    if (!judgmentResult) {
      throw new NotFoundException(`JudgmentResult not found: ${id}.`);
    }

    return {
      debate: mapDebateToDto(debate),
      judgmentResult: mapJudgmentResultResponse(judgmentResult),
    };
  }

  async startDebate(id: string): Promise<DebateDto> {
    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: { id },
    });

    if (!debate) {
      throw new NotFoundException(`Debate not found: ${id}.`);
    }

    if (debate.status === DebateStatus.IN_PROGRESS) {
      return mapDebateToDto(debate);
    }

    if (debate.status !== DebateStatus.READY) {
      throw new ConflictException(`Debate cannot start from ${debate.status}.`);
    }

    const now = new Date();
    const updateResult = await this.dataSource
      .createQueryBuilder()
      .update(DebateEntity)
      .set({
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.OPENING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: now,
        startedAt: now,
      })
      .where("id = :id", { id })
      .andWhere("status = :status", { status: DebateStatus.READY })
      .execute();

    if (updateResult.affected !== 1) {
      throw new ConflictException("Debate could not be started.");
    }

    return this.getDebate(id);
  }

  async transitionToJudging(id: string): Promise<DebateDto> {
    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: { id },
    });

    if (!debate) {
      throw new NotFoundException(`Debate not found: ${id}.`);
    }

    if (debate.status === DebateStatus.JUDGING) {
      return mapDebateToDto(debate);
    }

    if (debate.status !== DebateStatus.DEBATE_FINALIZED) {
      throw new ConflictException(
        `Debate cannot transition to JUDGING from ${debate.status}.`,
      );
    }

    await this.judgeReadinessService.tryStartJudge(id);

    const updatedDebate = await this.getDebate(id);

    if (updatedDebate.status === DebateStatus.DEBATE_FINALIZED) {
      throw new ConflictException(
        "Debate does not satisfy all Judge readiness conditions.",
      );
    }

    return updatedDebate;
  }

  private async assertDebateSpeakersExist(
    input: CreateDebateRequest,
  ): Promise<void> {
    const memberCount = await this.dataSource
      .getRepository(MemberEntity)
      .createQueryBuilder("member")
      .where("member.id IN (:...ids)", {
        ids: [input.sideASpeakerId, input.sideBSpeakerId],
      })
      .getCount();

    if (memberCount !== 2) {
      throw new BadRequestException(
        "sideASpeakerId and sideBSpeakerId must reference existing members.",
      );
    }
  }
}

function mapDebateToDto(debate: DebateEntity): DebateDto {
  return {
    id: debate.id,
    topic: debate.topic,
    sideASpeakerId: debate.sideASpeakerId,
    sideBSpeakerId: debate.sideBSpeakerId,
    rebuttalQuestionRounds: debate.rebuttalQuestionRounds,
    status: debate.status,
    currentPhase: debate.currentPhase,
    currentRound: debate.currentRound,
    currentTurnSide: debate.currentTurnSide,
    currentTurnStartedAt: debate.currentTurnStartedAt?.toISOString() ?? null,
    createdAt: debate.createdAt.toISOString(),
    startedAt: debate.startedAt?.toISOString() ?? null,
    endedAt: debate.endedAt?.toISOString() ?? null,
    judgingStartedAt: debate.judgingStartedAt?.toISOString() ?? null,
  };
}
