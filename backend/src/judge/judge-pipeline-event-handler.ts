import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { DebatePipelineEventBus } from "../ai/debate-pipeline-event-bus";
import { JudgeReadinessService } from "./judge-readiness.service";

@Injectable()
export class JudgePipelineEventHandler implements OnApplicationBootstrap, OnApplicationShutdown {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly pipelineEventBus: DebatePipelineEventBus,
    private readonly readinessService: JudgeReadinessService,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.pipelineEventBus.subscribe((event) => {
      void this.readinessService.tryStartJudge(event.debateId);
    });
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
