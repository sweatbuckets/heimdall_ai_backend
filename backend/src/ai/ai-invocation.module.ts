import { Module } from "@nestjs/common";
import { AiInvocationCancellationService } from "./ai-invocation-cancellation.service";
import { DebateProcessingEventBus } from "./debate-processing-event-bus";
import { DebatePipelineEventBus } from "./debate-pipeline-event-bus";

@Module({
  providers: [AiInvocationCancellationService, DebateProcessingEventBus, DebatePipelineEventBus],
  exports: [AiInvocationCancellationService, DebateProcessingEventBus, DebatePipelineEventBus],
})
export class AiInvocationModule {}
