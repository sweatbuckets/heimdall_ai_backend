import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GeminiModule } from "../ai/gemini/gemini.module";
import { AiInvocationModule } from "../ai/ai-invocation.module";
import { debateEntities } from "../database/typeorm.config";
import { FactCheckModule } from "../fact-check/fact-check.module";
import { ANALYZER_QUEUE } from "./constants";
import { AnalyzerAiService } from "./analyzer-ai.service";
import { AnalyzerInputAssembler } from "./analyzer-input.assembler";
import { AnalyzerRecoveryScheduler } from "./analyzer-recovery.scheduler";
import { AnalyzerQueueService } from "./queues/analyzer-queue.service";
import { AnalyzerProcessor } from "./queues/analyzer.processor";
import { AnalyzeTurnService } from "./analyze-turn.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([...debateEntities]),
    BullModule.registerQueue({ name: ANALYZER_QUEUE }),
    GeminiModule,
    AiInvocationModule,
    FactCheckModule,
  ],
  providers: [
    AnalyzeTurnService,
    AnalyzerInputAssembler,
    AnalyzerAiService,
    AnalyzerQueueService,
    AnalyzerProcessor,
    AnalyzerRecoveryScheduler,
  ],
  exports: [AnalyzeTurnService, AnalyzerQueueService],
})
export class AnalyzerModule {}
