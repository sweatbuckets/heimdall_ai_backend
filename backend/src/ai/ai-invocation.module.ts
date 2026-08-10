import { Module } from "@nestjs/common";
import { AiInvocationCancellationService } from "./ai-invocation-cancellation.service";

@Module({
  providers: [AiInvocationCancellationService],
  exports: [AiInvocationCancellationService],
})
export class AiInvocationModule {}
