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

export const debateEntities = [
  MemberEntity,
  DebateEntity,
  DebateTurnEntity,
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
