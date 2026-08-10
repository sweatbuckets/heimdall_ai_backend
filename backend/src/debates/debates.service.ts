import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { MemberEntity } from "../members/entities/member.entity";
import {
  DebatePhase,
  DebateSide,
  DebateStatus,
  DebateTurnVoteType,
} from "./domain/debate.enums";
import {
  DebateTurnVoteSummaryDto,
  DebateTurnWithVotesDto,
} from "./dto/debate-turn-vote.dto";
import {
  CreateDebateRequest,
  DebateDetailDto,
  DebateDto,
  DebateResultDto,
} from "./dto/debate.dto";
import { DebateEntity } from "./entities/debate.entity";
import { DebateTurnEntity } from "./entities/debate-turn.entity";
import { DebateTurnVoteEntity } from "./entities/debate-turn-vote.entity";
import { JudgmentResultEntity } from "./entities/judgment-result.entity";
import { mapJudgmentResultResponse } from "../judge/dto/judgment-result-response.dto";
import { JudgeReadinessService } from "../judge/judge-readiness.service";
import { CommunityMemberEntity } from "../community-chat/entities/community-member.entity";
import { CommunityEntity } from "../community-chat/entities/community.entity";
import { CommunityStatus } from "../community-chat/domain/community-chat.enums";
import { getDebateExpiresAt } from "./debate-timeout.constants";
import { DebateChatWebSocketServer } from "../debate-chat/debate-chat.websocket-server";

@Injectable()
export class DebatesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly judgeReadinessService: JudgeReadinessService,
    private readonly websocketServer: DebateChatWebSocketServer,
  ) {}

  async createDebate(input: CreateDebateRequest): Promise<DebateDto> {
    await this.assertDebateSpeakersBelongToCommunity(input);

    const id = randomUUID();

    await this.dataSource.getRepository(DebateEntity).insert({
      id,
      communityId: input.communityId,
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

  async getDebateDetail(
    id: string,
    viewerMemberId?: string,
  ): Promise<DebateDetailDto> {
    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: { id },
      relations: { sideASpeaker: true, sideBSpeaker: true },
    });

    if (!debate) {
      throw new NotFoundException(`Debate not found: ${id}.`);
    }

    return {
      ...mapDebateToDto(debate),
      sideASpeaker: mapSpeaker(debate.sideASpeaker),
      sideBSpeaker: mapSpeaker(debate.sideBSpeaker),
      viewerSide:
        viewerMemberId === debate.sideASpeakerId
          ? DebateSide.SIDE_A
          : viewerMemberId === debate.sideBSpeakerId
            ? DebateSide.SIDE_B
            : null,
      turns: await this.findDebateTurns(id),
    };
  }

  async startCommunityDebate(
    communityId: string,
    hostMemberId: string,
    opponentMemberId: string,
  ): Promise<DebateDetailDto> {
    if (hostMemberId === opponentMemberId) {
      throw new BadRequestException("A member cannot debate themselves.");
    }

    const claimed = await this.dataSource.transaction(async (manager) => {
      const community = await manager.findOne(CommunityEntity, {
        where: { id: communityId },
        lock: { mode: "pessimistic_write" },
      });
      if (!community) {
        throw new NotFoundException(`Community not found: ${communityId}.`);
      }
      if (community.hostId !== hostMemberId) {
        throw new ConflictException("Only the community host can start a debate.");
      }

      const opponentJoined = await manager.exists(CommunityMemberEntity, {
        where: { communityId, memberId: opponentMemberId },
      });
      if (!opponentJoined) {
        throw new BadRequestException("The opponent must be a community member.");
      }

      const activeStatuses = [
        DebateStatus.READY,
        DebateStatus.IN_PROGRESS,
        DebateStatus.DEBATE_FINALIZED,
        DebateStatus.JUDGING,
      ];
      const existing = await manager.findOne(DebateEntity, {
        where: { communityId, status: In(activeStatuses) },
        order: { createdAt: "DESC" },
      });
      if (existing) {
        if (
          existing.sideASpeakerId === hostMemberId &&
          existing.sideBSpeakerId === opponentMemberId
        ) {
          if (existing.status === DebateStatus.READY) {
            const now = new Date();
            await manager.update(
              DebateEntity,
              { id: existing.id, status: DebateStatus.READY },
              {
                status: DebateStatus.IN_PROGRESS,
                currentPhase: DebatePhase.OPENING,
                currentRound: 1,
                currentTurnSide: DebateSide.SIDE_A,
                currentTurnStartedAt: now,
                startedAt: now,
              },
            );
            await manager.update(
              CommunityEntity,
              { id: communityId },
              { status: CommunityStatus.ACTIVE },
            );
            return { debateId: existing.id, created: true };
          }
          return { debateId: existing.id, created: false };
        }
        throw new ConflictException("This community already has an active debate.");
      }

      const now = new Date();
      const id = randomUUID();
      await manager.insert(DebateEntity, {
        id,
        communityId,
        topic: community.topic,
        sideASpeakerId: hostMemberId,
        sideBSpeakerId: opponentMemberId,
        rebuttalQuestionRounds: community.rounds,
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.OPENING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: now,
        startedAt: now,
      });
      await manager.update(
        CommunityEntity,
        { id: communityId },
        { status: CommunityStatus.ACTIVE },
      );
      return { debateId: id, created: true };
    });

    const detail = await this.getDebateDetail(claimed.debateId, hostMemberId);
    if (claimed.created) {
      this.websocketServer.publishDebateStarted(communityId, {
        debateId: detail.id,
        sideASpeaker: detail.sideASpeaker,
        sideBSpeaker: detail.sideBSpeaker,
        startedAt: detail.startedAt,
        expiresAt: detail.expiresAt,
      });
    }
    return detail;
  }

  async getActiveCommunityDebate(
    communityId: string,
    viewerMemberId: string,
  ): Promise<DebateDetailDto | null> {
    const debate = await this.dataSource.getRepository(DebateEntity).findOne({
      where: {
        communityId,
        status: In([
          DebateStatus.IN_PROGRESS,
          DebateStatus.DEBATE_FINALIZED,
          DebateStatus.JUDGING,
        ]),
      },
      order: { createdAt: "DESC" },
    });
    return debate ? this.getDebateDetail(debate.id, viewerMemberId) : null;
  }

  async getDebateTurns(id: string): Promise<DebateTurnWithVotesDto[]> {
    await this.getDebate(id);
    return this.findDebateTurns(id);
  }

  async setDebateTurnVote(
    debateId: string,
    turnId: string,
    memberId: string,
    type: DebateTurnVoteType,
  ): Promise<DebateTurnVoteSummaryDto> {
    await this.assertTurnAndMemberExist(debateId, turnId, memberId);

    await this.dataSource.query(
      `
        INSERT INTO "debate_turn_vote"
          ("id", "turn_id", "member_id", "type", "created_at", "updated_at")
        VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT ("turn_id", "member_id")
        DO UPDATE SET
          "type" = EXCLUDED."type",
          "updated_at" = now()
      `,
      [randomUUID(), turnId, memberId, type],
    );

    return this.getTurnVoteSummary(turnId);
  }

  async removeDebateTurnVote(
    debateId: string,
    turnId: string,
    memberId: string,
  ): Promise<DebateTurnVoteSummaryDto> {
    await this.assertTurnAndMemberExist(debateId, turnId, memberId);

    await this.dataSource.getRepository(DebateTurnVoteEntity).delete({
      turnId,
      memberId,
    });

    return this.getTurnVoteSummary(turnId);
  }

  async getDebateResult(
    id: string,
    viewerMemberId?: string,
  ): Promise<DebateResultDto> {
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
      viewerSide:
        viewerMemberId === debate.sideASpeakerId
          ? DebateSide.SIDE_A
          : viewerMemberId === debate.sideBSpeakerId
            ? DebateSide.SIDE_B
            : null,
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

  private async assertDebateSpeakersBelongToCommunity(
    input: CreateDebateRequest,
  ): Promise<void> {
    const memberCount = await this.dataSource
      .getRepository(CommunityMemberEntity)
      .createQueryBuilder("membership")
      .where("membership.community_id = :communityId", {
        communityId: input.communityId,
      })
      .andWhere("membership.member_id IN (:...ids)", {
        ids: [input.sideASpeakerId, input.sideBSpeakerId],
      })
      .getCount();

    if (memberCount !== 2) {
      throw new BadRequestException(
        "Both debate speakers must be members of the selected community.",
      );
    }
  }

  private async findDebateTurns(id: string): Promise<DebateTurnWithVotesDto[]> {
    const turns = await this.dataSource.getRepository(DebateTurnEntity).find({
      where: { debateId: id },
      order: { sequence: "ASC" },
    });

    const voteCounts = await this.findTurnVoteCounts(
      turns.map((turn) => turn.id),
    );

    return turns.map((turn) => {
      const counts = voteCounts.get(turn.id) ?? EMPTY_VOTE_COUNTS;

      return {
        id: turn.id,
        debateId: turn.debateId,
        speakerId: turn.speakerId,
        speakerSide: turn.speakerSide,
        phase: turn.phase,
        round: turn.round,
        sequence: turn.sequence,
        content: turn.content,
        createdAt: turn.createdAt.toISOString(),
        ...counts,
      };
    });
  }

  private async assertTurnAndMemberExist(
    debateId: string,
    turnId: string,
    memberId: string,
  ): Promise<void> {
    const [turnExists, memberExists] = await Promise.all([
      this.dataSource.getRepository(DebateTurnEntity).exists({
        where: { id: turnId, debateId },
      }),
      this.dataSource.getRepository(MemberEntity).exists({
        where: { id: memberId },
      }),
    ]);

    if (!turnExists) {
      throw new NotFoundException(
        `DebateTurn not found in debate ${debateId}: ${turnId}.`,
      );
    }

    if (!memberExists) {
      throw new NotFoundException(`Member not found: ${memberId}.`);
    }
  }

  private async getTurnVoteSummary(
    turnId: string,
  ): Promise<DebateTurnVoteSummaryDto> {
    const counts =
      (await this.findTurnVoteCounts([turnId])).get(turnId) ??
      EMPTY_VOTE_COUNTS;

    return { turnId, ...counts };
  }

  private async findTurnVoteCounts(
    turnIds: string[],
  ): Promise<Map<string, VoteCounts>> {
    if (turnIds.length === 0) {
      return new Map();
    }

    const rows = await this.dataSource
      .getRepository(DebateTurnVoteEntity)
      .createQueryBuilder("vote")
      .select("vote.turnId", "turnId")
      .addSelect("vote.type", "type")
      .addSelect("COUNT(*)", "count")
      .where("vote.turnId IN (:...turnIds)", { turnIds })
      .groupBy("vote.turnId")
      .addGroupBy("vote.type")
      .getRawMany<VoteCountRow>();

    const result = new Map<string, VoteCounts>();

    for (const row of rows) {
      const counts = result.get(row.turnId) ?? {
        likeCount: 0,
        dislikeCount: 0,
      };
      const count = Number(row.count);

      if (row.type === DebateTurnVoteType.LIKE) {
        counts.likeCount = count;
      } else {
        counts.dislikeCount = count;
      }

      result.set(row.turnId, counts);
    }

    return result;
  }
}

interface VoteCountRow {
  turnId: string;
  type: DebateTurnVoteType;
  count: string;
}

interface VoteCounts {
  likeCount: number;
  dislikeCount: number;
}

const EMPTY_VOTE_COUNTS: VoteCounts = {
  likeCount: 0,
  dislikeCount: 0,
};

function mapDebateToDto(debate: DebateEntity): DebateDto {
  return {
    id: debate.id,
    communityId: debate.communityId,
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
    expiresAt: getDebateExpiresAt(debate.startedAt)?.toISOString() ?? null,
  };
}

function mapSpeaker(member: MemberEntity): {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
} {
  return {
    id: member.id,
    displayName: member.displayName,
    profileImageUrl: member.profileImageUrl,
  };
}
