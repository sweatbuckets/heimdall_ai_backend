import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GeminiModule } from "../ai/gemini/gemini.module";
import { AiInvocationModule } from "../ai/ai-invocation.module";
import { debateEntities } from "../database/typeorm.config";
import { JudgeAiService } from "./judge-ai.service";
import { JudgeController } from "./judge.controller";
import { JudgeInputAssembler } from "./judge-input.assembler";
import { JudgeReadinessService } from "./judge-readiness.service";
import { JudgeService } from "./judge.service";
import { CommunityChatModule } from "../community-chat/community-chat.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([...debateEntities]),
    GeminiModule,
    AiInvocationModule,
    CommunityChatModule,
  ],
  controllers: [JudgeController],
  providers: [
    JudgeService,
    JudgeReadinessService,
    JudgeInputAssembler,
    JudgeAiService,
  ],
  exports: [JudgeService, JudgeReadinessService],
})
export class JudgeModule {}
