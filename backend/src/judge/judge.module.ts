import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
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
import { JudgeQueueService } from "./judge-queue.service";
import { JudgeTaskService } from "./judge-task.service";
import { JudgeProcessor } from "./queues/judge.processor";
import { JUDGE_QUEUE } from "./queues/judge.constants";
import { JudgeRecoveryScheduler } from "./judge-recovery.scheduler";

@Module({
  imports: [
    TypeOrmModule.forFeature([...debateEntities]),
    BullModule.registerQueue({ name: JUDGE_QUEUE }),
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
    JudgeQueueService,
    JudgeTaskService,
    JudgeProcessor,
    JudgeRecoveryScheduler,
  ],
  exports: [JudgeReadinessService, JudgeQueueService],
})
export class JudgeModule {}
