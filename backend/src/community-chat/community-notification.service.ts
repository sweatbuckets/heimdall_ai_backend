import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { CommunityMessageDto } from "./dto/community-chat.dto";
import {
  CommunityMessageEntity,
  CommunityMessageType,
} from "./entities/community-message.entity";

type NotificationListener = (message: CommunityMessageDto) => void;

@Injectable()
export class CommunityNotificationService {
  private readonly listeners = new Set<NotificationListener>();

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createDebateResult(
    manager: EntityManager,
    communityId: string,
    debateId: string,
  ): Promise<CommunityMessageDto> {
    return this.create(
      manager,
      communityId,
      debateId,
      CommunityMessageType.DEBATE_RESULT,
      "토론이 종료되었습니다. 결과와 팩트체크를 확인해 보세요.",
    );
  }

  createDebateForfeit(
    manager: EntityManager,
    communityId: string,
    debateId: string,
    forfeitingUsername: string,
  ): Promise<CommunityMessageDto> {
    return this.create(
      manager,
      communityId,
      debateId,
      CommunityMessageType.DEBATE_FORFEIT,
      `${forfeitingUsername}님이 기권하여 토론이 종료되었습니다.`,
    );
  }

  publish(message: CommunityMessageDto): void {
    for (const listener of this.listeners) listener(message);
  }

  private async create(
    manager: EntityManager,
    communityId: string,
    debateId: string,
    type: CommunityMessageType,
    text: string,
  ): Promise<CommunityMessageDto> {
    const id = randomUUID();
    const createdAt = new Date();
    await manager.insert(CommunityMessageEntity, {
      id,
      communityId,
      authorId: null,
      clientMessageId: `${type.toLowerCase()}:${debateId}`,
      body: text,
      type,
      debateId,
      createdAt,
    });
    return {
      id,
      communityId,
      clientMessageId: `${type.toLowerCase()}:${debateId}`,
      authorId: "system",
      authorName: "헤임달",
      text,
      messageType: type,
      debateId,
      createdAt: createdAt.toISOString(),
    };
  }
}
