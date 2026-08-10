import { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { DebateEntity } from "../debates/entities/debate.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { ArgumentalRelationEntity } from "../debates/entities/argumental-relation.entity";
import { InteractionalRelationEntity } from "../debates/entities/interactional-relation.entity";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";
import { FactCheckBatchTargetEntity } from "../debates/entities/fact-check-batch-target.entity";
import { FactCheckResultEntity } from "../debates/entities/fact-check-result.entity";
import { FactCheckSourceEntity } from "../debates/entities/fact-check-source.entity";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";
import { MemberEntity } from "../members/entities/member.entity";
import { DebateTurnVoteEntity } from "../debates/entities/debate-turn-vote.entity";
import { RefreshTokenSessionEntity } from "../auth/entities/refresh-token-session.entity";
import { CommunityEntity } from "../community-chat/entities/community.entity";
import { CommunityMemberEntity } from "../community-chat/entities/community-member.entity";
import { CommunityMessageEntity } from "../community-chat/entities/community-message.entity";
import { CommunityOpinionEntity } from "../community-chat/entities/community-opinion.entity";

export const debateEntities = [
  MemberEntity,
  RefreshTokenSessionEntity,
  CommunityEntity,
  CommunityMemberEntity,
  CommunityMessageEntity,
  CommunityOpinionEntity,
  DebateEntity,
  DebateTurnEntity,
  DebateTurnVoteEntity,
  ArgumentComponentEntity,
  ArgumentalRelationEntity,
  InteractionalRelationEntity,
  FactCheckBatchTaskEntity,
  FactCheckBatchTargetEntity,
  FactCheckResultEntity,
  FactCheckSourceEntity,
  JudgmentResultEntity,
] as const;

export function createTypeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: "postgres",
    url: process.env.DATABASE_URL,
    entities: [...debateEntities],
    synchronize: false,
    migrationsRun: false,
    autoLoadEntities: false,
  };
}
