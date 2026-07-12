import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GeminiModule } from "../ai/gemini/gemini.module";
import { debateEntities } from "../database/typeorm.config";
import { FACT_CHECK_QUEUE } from "../fact-check/queues/fact-check.constants";
import { ANALYZER_QUEUE } from "./constants";
import { AnalyzerAiService } from "./analyzer-ai.service";
import { AnalyzerInputAssembler } from "./analyzer-input.assembler";
import { AnalyzerQueueService } from "./queues/analyzer-queue.service";
import { AnalyzerProcessor } from "./queues/analyzer.processor";
import { AnalyzeTurnService } from "./analyze-turn.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([...debateEntities]),
    BullModule.registerQueue(
      {
        name: ANALYZER_QUEUE,
      },
      {
        name: FACT_CHECK_QUEUE,
      },
    ),
    GeminiModule,
  ],
  providers: [
    AnalyzeTurnService,
    AnalyzerInputAssembler,
    AnalyzerAiService,
    AnalyzerQueueService,
    AnalyzerProcessor,
  ],
  exports: [AnalyzeTurnService, AnalyzerQueueService],
})
export class AnalyzerModule {}
