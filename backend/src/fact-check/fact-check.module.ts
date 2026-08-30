import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GeminiModule } from "../ai/gemini/gemini.module";
import { AiInvocationModule } from "../ai/ai-invocation.module";
import { debateEntities } from "../database/typeorm.config";
import { FactCheckGroundingTaskService } from "./fact-check-grounding-task.service";
import { FactCheckInputAssembler } from "./fact-check-input.assembler";
import { FactCheckQueueService } from "./fact-check-queue.service";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { FactCheckSynthesisTaskService } from "./fact-check-synthesis-task.service";
import { FactCheckRecoveryScheduler } from "./fact-check-recovery.scheduler";
import {
  FACT_CHECK_GROUNDING_QUEUE,
  FACT_CHECK_SYNTHESIS_QUEUE,
} from "./queues/fact-check.constants";
import { FactCheckGroundingProcessor } from "./queues/fact-check-grounding.processor";
import { FactCheckSynthesisProcessor } from "./queues/fact-check-synthesis.processor";

@Module({
  imports: [
    TypeOrmModule.forFeature([...debateEntities]),
    BullModule.registerQueue(
      { name: FACT_CHECK_GROUNDING_QUEUE },
      { name: FACT_CHECK_SYNTHESIS_QUEUE },
    ),
    GeminiModule,
    AiInvocationModule,
  ],
  providers: [
    FactCheckGroundingTaskService,
    FactCheckSynthesisTaskService,
    FactCheckInputAssembler,
    FactCheckQueueService,
    FactCheckerAiService,
    FactCheckGroundingProcessor,
    FactCheckSynthesisProcessor,
    FactCheckRecoveryScheduler,
  ],
  exports: [FactCheckQueueService],
})
export class FactCheckModule {}
