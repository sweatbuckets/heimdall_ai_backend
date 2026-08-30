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
  DebateInvitationDto,
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
import {
  CommunityDebateIntent,
  CommunityStatus,
} from "../community-chat/domain/community-chat.enums";
import { CommunityOpinionEntity } from "../community-chat/entities/community-opinion.entity";
import {
  getDebateExpiresAt,
  getDebateStartsAt,
} from "./debate-timeout.constants";
import { DebateChatWebSocketServer } from "../debate-chat/debate-chat.websocket-server";
import { FactCheckResultEntity } from "./entities/fact-check-result.entity";
import {
  FactCheckResultResponseDto,
  mapFactCheckResultResponse,
} from "./dto/fact-check-result-response.dto";
import { CommunityNotificationService } from "../community-chat/community-notification.service";

const DEBATE_INVITATION_TIMEOUT_MS = 5_000;

interface PendingDebateInvitation extends DebateInvitationDto {
  timeout: ReturnType<typeof setTimeout>;
}

@Injectable()
export class DebatesService {
  private readonly pendingInvitations = new Map<
    string,
    PendingDebateInvitation
  >();
  private readonly pendingInvitationByCommunity = new Map<string, string>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly judgeReadinessService: JudgeReadinessService,
    private readonly websocketServer: DebateChatWebSocketServer,
    private readonly communityNotificationService: CommunityNotificationService,
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

    const opinions = await this.dataSource
      .getRepository(CommunityOpinionEntity)
      .find({
        where: {
          communityId: debate.communityId,
          authorId: In([debate.sideASpeakerId, debate.sideBSpeakerId]),
        },
      });
    const opinionsByAuthorId = new Map(
      opinions.map((opinion) => [opinion.authorId, opinion]),
    );

    return {
      ...mapDebateToDto(debate),
      sideASpeaker: mapSpeaker(
        debate.sideASpeaker,
        opinionsByAuthorId.get(debate.sideASpeakerId),
      ),
      sideBSpeaker: mapSpeaker(
        debate.sideBSpeaker,
        opinionsByAuthorId.get(debate.sideBSpeakerId),
      ),
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
  ): Promise<DebateInvitationDto> {
    if (hostMemberId === opponentMemberId) {
      throw new BadRequestException("A member cannot debate themselves.");
    }

    if (this.pendingInvitationByCommunity.has(communityId)) {
      throw new ConflictException(
        "This community already has a pending debate invitation.",
      );
    }

    const hostName = await this.dataSource.transaction(async (manager) => {
      const community = await manager.findOne(CommunityEntity, {
        where: { id: communityId },
        lock: { mode: "pessimistic_write" },
      });
      if (!community) {
        throw new NotFoundException(`Community not found: ${communityId}.`);
      }
      if (community.hostId !== hostMemberId) {
        throw new ConflictException(
          "Only the community host can start a debate.",
        );
      }

      const opponentMembership = await manager.findOne(CommunityMemberEntity, {
        where: { communityId, memberId: opponentMemberId },
      });
      if (!opponentMembership) {
        throw new BadRequestException(
          "The opponent must be a community member.",
        );
      }
      if (
        opponentMembership.debateIntent !== CommunityDebateIntent.OPEN_TO_DEBATE
      ) {
        throw new ConflictException("The opponent is not ready to debate.");
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
        throw new ConflictException(
          "This community already has an active debate.",
        );
      }

      const hostMember = await manager.findOne(MemberEntity, {
        where: { id: hostMemberId },
        select: { id: true, displayName: true },
      });
      if (!hostMember) {
        throw new BadRequestException("The community host must exist.");
      }
      return hostMember.displayName;
    });

    if (this.pendingInvitationByCommunity.has(communityId)) {
      throw new ConflictException(
        "This community already has a pending debate invitation.",
      );
    }
    const id = randomUUID();
    const expiresAt = new Date(
      Date.now() + DEBATE_INVITATION_TIMEOUT_MS,
    ).toISOString();
    const dto: DebateInvitationDto = {
      id,
      communityId,
      hostMemberId,
      hostName,
      opponentMemberId,
      expiresAt,
    };
    const timeout = setTimeout(
      () => this.expireDebateInvitation(id),
      DEBATE_INVITATION_TIMEOUT_MS,
    );
    this.pendingInvitations.set(id, { ...dto, timeout });
    this.pendingInvitationByCommunity.set(communityId, id);
    this.websocketServer.publishDebateRequested(communityId, opponentMemberId, {
      invitation: dto,
    });
    return dto;
  }

  async acceptCommunityDebateInvitation(
    communityId: string,
    invitationId: string,
    opponentMemberId: string,
  ): Promise<DebateDetailDto> {
    const invitation = this.takeDebateInvitation(
      communityId,
      invitationId,
      opponentMemberId,
    );
    const accepted = await this.dataSource.transaction(async (manager) => {
      const community = await manager.findOne(CommunityEntity, {
        where: { id: communityId },
        lock: { mode: "pessimistic_write" },
      });
      if (!community) {
        throw new NotFoundException(`Community not found: ${communityId}.`);
      }
      const membership = await manager.findOne(CommunityMemberEntity, {
        where: { communityId, memberId: opponentMemberId },
      });
      if (
        !membership ||
        membership.debateIntent !== CommunityDebateIntent.OPEN_TO_DEBATE
      ) {
        throw new ConflictException("The opponent is not ready to debate.");
      }
      const speakers = await manager.find(MemberEntity, {
        where: {
          id: In([invitation.hostMemberId, invitation.opponentMemberId]),
        },
        select: { id: true, displayName: true },
      });
      const names = new Map(
        speakers.map((speaker) => [speaker.id, speaker.displayName]),
      );
      const hostName = names.get(invitation.hostMemberId);
      const opponentName = names.get(invitation.opponentMemberId);
      if (!hostName || !opponentName) {
        throw new BadRequestException("Both debate speakers must exist.");
      }
      const existing = await manager.findOne(DebateEntity, {
        where: {
          communityId,
          status: In([
            DebateStatus.READY,
            DebateStatus.IN_PROGRESS,
            DebateStatus.DEBATE_FINALIZED,
            DebateStatus.JUDGING,
          ]),
        },
      });
      if (existing) {
        throw new ConflictException(
          "This community already has an active debate.",
        );
      }
      const startsAt = getDebateStartsAt();
      const debateId = randomUUID();
      await manager.insert(DebateEntity, {
        id: debateId,
        communityId,
        topic: community.topic,
        sideASpeakerId: invitation.hostMemberId,
        sideBSpeakerId: invitation.opponentMemberId,
        rebuttalQuestionRounds: community.rounds,
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.OPENING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: startsAt,
        startedAt: startsAt,
      });
      await manager.update(
        CommunityEntity,
        { id: communityId },
        { status: CommunityStatus.ACTIVE },
      );
      const notification =
        await this.communityNotificationService.createDebateStarted(
          manager,
          communityId,
          debateId,
          hostName,
          opponentName,
        );
      return { debateId, notification };
    });

    const detail = await this.getDebateDetail(
      accepted.debateId,
      opponentMemberId,
    );
    this.communityNotificationService.publish(accepted.notification);
    this.websocketServer.publishDebateStarted(communityId, {
      debateId: detail.id,
      sideASpeaker: detail.sideASpeaker,
      sideBSpeaker: detail.sideBSpeaker,
      startedAt: detail.startedAt,
      expiresAt: detail.expiresAt,
    });
    return detail;
  }

  async rejectCommunityDebateInvitation(
    communityId: string,
    invitationId: string,
    opponentMemberId: string,
  ): Promise<void> {
    const invitation = this.takeDebateInvitation(
      communityId,
      invitationId,
      opponentMemberId,
    );
    this.websocketServer.publishDebateRequestRejected(
      communityId,
      invitation.hostMemberId,
      { invitationId, opponentMemberId },
    );
  }

  private takeDebateInvitation(
    communityId: string,
    invitationId: string,
    opponentMemberId: string,
  ): PendingDebateInvitation {
    const invitation = this.pendingInvitations.get(invitationId);
    if (!invitation || invitation.communityId !== communityId) {
      throw new NotFoundException(
        `Debate invitation not found or expired: ${invitationId}.`,
      );
    }
    if (invitation.opponentMemberId !== opponentMemberId) {
      throw new ConflictException("Only the invited member can respond.");
    }
    clearTimeout(invitation.timeout);
    this.pendingInvitations.delete(invitationId);
    this.pendingInvitationByCommunity.delete(communityId);
    return invitation;
  }

  private expireDebateInvitation(invitationId: string): void {
    const invitation = this.pendingInvitations.get(invitationId);
    if (!invitation) return;
    this.pendingInvitations.delete(invitationId);
    this.pendingInvitationByCommunity.delete(invitation.communityId);
    this.websocketServer.publishDebateRequestExpired(
      invitation.communityId,
      invitation.hostMemberId,
      invitation.opponentMemberId,
      { invitationId },
    );
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

    const factChecks = await this.findDebateFactChecks(id);

    return {
      debate: mapDebateToDto(debate),
      viewerSide:
        viewerMemberId === debate.sideASpeakerId
          ? DebateSide.SIDE_A
          : viewerMemberId === debate.sideBSpeakerId
            ? DebateSide.SIDE_B
            : null,
      judgmentResult: mapJudgmentResultResponse(judgmentResult),
      factChecks,
    };
  }

  private async findDebateFactChecks(
    debateId: string,
  ): Promise<FactCheckResultResponseDto[]> {
    const results = await this.dataSource
      .getRepository(FactCheckResultEntity)
      .createQueryBuilder("factCheck")
      .innerJoinAndSelect("factCheck.component", "component")
      .innerJoinAndSelect("component.turn", "turn")
      .leftJoinAndSelect("factCheck.sources", "source")
      .where("turn.debate_id = :debateId", { debateId })
      .orderBy("turn.sequence", "ASC")
      .addOrderBy("component.createdAt", "ASC")
      .addOrderBy("source.createdAt", "ASC")
      .getMany();

    return results.map(mapFactCheckResultResponse);
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

    const startsAt = getDebateStartsAt();
    const updateResult = await this.dataSource
      .createQueryBuilder()
      .update(DebateEntity)
      .set({
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.OPENING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: startsAt,
        startedAt: startsAt,
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
    expiresAt:
      getDebateExpiresAt(
        debate.startedAt,
        debate.rebuttalQuestionRounds,
      )?.toISOString() ?? null,
  };
}

function mapSpeaker(
  member: MemberEntity,
  opinion?: CommunityOpinionEntity,
): {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  score: number;
  claim: string;
  reasons: string[];
} {
  return {
    id: member.id,
    displayName: member.displayName,
    profileImageUrl: member.profileImageUrl,
    score: member.score,
    claim: opinion?.claim ?? "",
    reasons: opinion?.reasons ?? [],
  };
}
