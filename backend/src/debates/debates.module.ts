import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { debateEntities } from "../database/typeorm.config";
import { JudgeModule } from "../judge/judge.module";
import { AiInvocationModule } from "../ai/ai-invocation.module";
import { AnalyzerModule } from "../analyzer/analyzer.module";
import { DebateChatModule } from "../debate-chat/debate-chat.module";
import {
  FACT_CHECK_GROUNDING_QUEUE,
  FACT_CHECK_SYNTHESIS_QUEUE,
} from "../fact-check/queues/fact-check.constants";
import { DebatesController } from "./debates.controller";
import { DebatesService } from "./debates.service";
import { CommunityDebatesController } from "./community-debates.controller";
import { DebateTimeoutService } from "./debate-timeout.service";
import { CommunityChatModule } from "../community-chat/community-chat.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([...debateEntities]),
    BullModule.registerQueue(
      { name: FACT_CHECK_GROUNDING_QUEUE },
      { name: FACT_CHECK_SYNTHESIS_QUEUE },
    ),
    JudgeModule,
    AiInvocationModule,
    AnalyzerModule,
    DebateChatModule,
    CommunityChatModule,
  ],
  controllers: [DebatesController, CommunityDebatesController],
  providers: [DebatesService, DebateTimeoutService],
  exports: [DebatesService],
})
export class DebatesModule {}
