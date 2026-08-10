import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, In, LessThan } from "typeorm";
import {
  CommunityDebateIntent,
  CommunityMemberRole,
  CommunityStatus,
} from "./domain/community-chat.enums";
import {
  CommunityDto,
  CommunityMemberDto,
  CommunityMessageDto,
  CommunityOpinionDto,
  CreateCommunityRequest,
  SaveCommunityOpinionRequest,
  SendCommunityMessageRequest,
} from "./dto/community-chat.dto";
import { CommunityEntity } from "./entities/community.entity";
import { CommunityMemberEntity } from "./entities/community-member.entity";
import { CommunityMessageEntity } from "./entities/community-message.entity";
import { CommunityOpinionEntity } from "./entities/community-opinion.entity";

@Injectable()
export class CommunityChatService {
  constructor(private readonly dataSource: DataSource) {}

  async createCommunity(
    memberId: string,
    input: CreateCommunityRequest,
  ): Promise<CommunityDto> {
    const communityId = randomUUID();
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(CommunityEntity).insert({
        id: communityId,
        hostId: memberId,
        title: input.title,
        topic: input.topic,
        category: input.category,
        status: CommunityStatus.WAITING,
        rounds: input.rounds,
        isPublic: input.isPublic,
        hostClaim: input.hostClaim,
        hostReasons: input.hostReasons,
      });
      await manager.getRepository(CommunityMemberEntity).insert({
        communityId,
        memberId,
        role: CommunityMemberRole.HOST,
      });
      await manager.getRepository(CommunityOpinionEntity).insert({
        communityId,
        authorId: memberId,
        claim: input.hostClaim,
        reasons: input.hostReasons,
      });
    });
    return this.getCommunity(communityId, memberId);
  }

  async listCommunities(memberId: string): Promise<CommunityDto[]> {
    const communities = await this.dataSource
      .getRepository(CommunityEntity)
      .find({ relations: { host: true }, order: { createdAt: "DESC" } });
    const counts = await this.loadMemberCounts(
      communities.map((item) => item.id),
    );
    const joinedIds = await this.loadJoinedCommunityIds(
      communities.map((item) => item.id),
      memberId,
    );
    return communities.map((community) =>
      mapCommunity(
        community,
        counts.get(community.id) ?? 0,
        memberId,
        joinedIds.has(community.id),
      ),
    );
  }

  async getCommunity(
    communityId: string,
    memberId: string,
  ): Promise<CommunityDto> {
    const community = await this.getCommunityEntity(communityId);
    const count = await this.dataSource
      .getRepository(CommunityMemberEntity)
      .countBy({ communityId });
    const isJoined = await this.dataSource
      .getRepository(CommunityMemberEntity)
      .exist({ where: { communityId, memberId } });
    return mapCommunity(community, count, memberId, isJoined);
  }

  async joinCommunity(communityId: string, memberId: string): Promise<void> {
    const community = await this.getCommunityEntity(communityId);
    await this.dataSource.getRepository(CommunityMemberEntity).upsert(
      {
        communityId,
        memberId,
        role:
          community.hostId === memberId
            ? CommunityMemberRole.HOST
            : CommunityMemberRole.MEMBER,
      },
      ["communityId", "memberId"],
    );
  }

  async listCommunityMembers(
    communityId: string,
  ): Promise<CommunityMemberDto[]> {
    await this.assertCommunityExists(communityId);
    const memberships = await this.dataSource
      .getRepository(CommunityMemberEntity)
      .createQueryBuilder("membership")
      .innerJoinAndSelect("membership.member", "member")
      .where("membership.community_id = :communityId", { communityId })
      .orderBy(
        `CASE WHEN membership.debate_intent = :openIntent THEN 0 ELSE 1 END`,
        "ASC",
      )
      .addOrderBy("membership.role", "ASC")
      .addOrderBy("membership.joined_at", "ASC")
      .setParameter("openIntent", CommunityDebateIntent.OPEN_TO_DEBATE)
      .getMany();

    return memberships.map((membership) => ({
      id: membership.member.id,
      displayName: membership.member.displayName,
      profileImageUrl: membership.member.profileImageUrl,
      role: membership.role,
      debateIntent: membership.debateIntent,
      joinedAt: membership.joinedAt.toISOString(),
    }));
  }

  async updateCommunityDebateIntent(
    communityId: string,
    memberId: string,
    debateIntent: CommunityDebateIntent,
  ): Promise<void> {
    const result = await this.dataSource
      .getRepository(CommunityMemberEntity)
      .update({ communityId, memberId }, { debateIntent });
    if (result.affected !== 1) {
      throw new NotFoundException(
        `Community member not found: ${communityId}/${memberId}.`,
      );
    }
  }

  async listMessages(
    communityId: string,
    limit = 50,
    before?: Date,
  ): Promise<CommunityMessageDto[]> {
    await this.assertCommunityExists(communityId);
    const messages = await this.dataSource
      .getRepository(CommunityMessageEntity)
      .find({
        where: {
          communityId,
          ...(before ? { createdAt: LessThan(before) } : {}),
        },
        relations: { author: true },
        order: { createdAt: "DESC" },
        take: Math.min(Math.max(limit, 1), 100),
      });
    return messages.reverse().map(mapMessage);
  }

  async sendMessage(
    communityId: string,
    memberId: string,
    input: SendCommunityMessageRequest,
  ): Promise<{ message: CommunityMessageDto; created: boolean }> {
    await this.joinCommunity(communityId, memberId);
    const repository = this.dataSource.getRepository(CommunityMessageEntity);
    const insert = await repository
      .createQueryBuilder()
      .insert()
      .values({
        communityId,
        authorId: memberId,
        clientMessageId: input.clientMessageId,
        body: input.text,
      })
      .orIgnore()
      .returning(["id"])
      .execute();

    const created = insert.identifiers.length === 1;
    const message = await repository.findOne({
      where: {
        communityId,
        authorId: memberId,
        clientMessageId: input.clientMessageId,
      },
      relations: { author: true },
    });
    if (!message) {
      throw new Error("Community message was not stored.");
    }
    return { message: mapMessage(message), created };
  }

  async listOpinions(communityId: string): Promise<CommunityOpinionDto[]> {
    await this.assertCommunityExists(communityId);
    const opinions = await this.dataSource
      .getRepository(CommunityOpinionEntity)
      .find({
        where: { communityId },
        relations: { author: true },
        order: { createdAt: "ASC" },
      });
    return opinions.map(mapOpinion);
  }

  async saveOpinion(
    communityId: string,
    memberId: string,
    input: SaveCommunityOpinionRequest,
  ): Promise<CommunityOpinionDto> {
    await this.joinCommunity(communityId, memberId);
    const repository = this.dataSource.getRepository(CommunityOpinionEntity);
    await repository.upsert(
      {
        communityId,
        authorId: memberId,
        claim: input.claim,
        reasons: input.reasons,
        updatedAt: new Date(),
      },
      ["communityId", "authorId"],
    );
    const opinion = await repository.findOne({
      where: { communityId, authorId: memberId },
      relations: { author: true },
    });
    if (!opinion) {
      throw new Error("Community opinion was not stored.");
    }
    return mapOpinion(opinion);
  }

  async assertCommunityExists(communityId: string): Promise<void> {
    const exists = await this.dataSource
      .getRepository(CommunityEntity)
      .exist({ where: { id: communityId } });
    if (!exists) {
      throw new NotFoundException(`Community not found: ${communityId}.`);
    }
  }

  private async getCommunityEntity(
    communityId: string,
  ): Promise<CommunityEntity> {
    const community = await this.dataSource
      .getRepository(CommunityEntity)
      .findOne({ where: { id: communityId }, relations: { host: true } });
    if (!community) {
      throw new NotFoundException(`Community not found: ${communityId}.`);
    }
    return community;
  }

  private async loadMemberCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.dataSource
      .getRepository(CommunityMemberEntity)
      .createQueryBuilder("member")
      .select("member.communityId", "communityId")
      .addSelect("COUNT(*)", "count")
      .where("member.communityId IN (:...ids)", { ids })
      .groupBy("member.communityId")
      .getRawMany<{ communityId: string; count: string }>();
    return new Map(rows.map((row) => [row.communityId, Number(row.count)]));
  }

  private async loadJoinedCommunityIds(
    communityIds: string[],
    memberId: string,
  ): Promise<Set<string>> {
    if (communityIds.length === 0) return new Set();
    const memberships = await this.dataSource
      .getRepository(CommunityMemberEntity)
      .find({
        select: { communityId: true },
        where: { communityId: In(communityIds), memberId },
      });
    return new Set(memberships.map((membership) => membership.communityId));
  }
}

function mapCommunity(
  community: CommunityEntity,
  memberCount: number,
  currentMemberId: string,
  isJoined: boolean,
): CommunityDto {
  return {
    id: community.id,
    title: community.title,
    topic: community.topic,
    category: community.category,
    status: community.status,
    rounds: community.rounds,
    isPublic: community.isPublic,
    hostClaim: community.hostClaim,
    hostReasons: community.hostReasons,
    host: { id: community.host.id, displayName: community.host.displayName },
    memberCount,
    createdAt: community.createdAt.toISOString(),
    isOwnedByCurrentUser: community.hostId === currentMemberId,
    isJoined,
  };
}

function mapMessage(message: CommunityMessageEntity): CommunityMessageDto {
  return {
    id: message.id,
    communityId: message.communityId,
    clientMessageId: message.clientMessageId,
    authorId: message.authorId,
    authorName: message.author.displayName,
    text: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

function mapOpinion(opinion: CommunityOpinionEntity): CommunityOpinionDto {
  return {
    id: opinion.id,
    communityId: opinion.communityId,
    authorId: opinion.authorId,
    authorName: opinion.author.displayName,
    claim: opinion.claim,
    reasons: opinion.reasons,
    createdAt: opinion.createdAt.toISOString(),
    updatedAt: opinion.updatedAt.toISOString(),
  };
}
