import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { DelayedError, Job } from "bullmq";
import {
  ANALYZER_QUEUE,
  ANALYZE_TURN_DEPENDENCY_RETRY_DELAY_MS,
  ANALYZE_TURN_JOB,
} from "../constants";
import { AnalyzeTurnService } from "../analyze-turn.service";
import { AnalyzeTurnJobData } from "./analyzer-job.data";
import { AnalyzeTurnDependencyPendingError } from "../errors/analyzer.errors";

@Processor(ANALYZER_QUEUE)
export class AnalyzerProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyzerProcessor.name);

  constructor(private readonly analyzeTurnService: AnalyzeTurnService) {
    super();
  }

  async process(job: Job<AnalyzeTurnJobData>, token?: string): Promise<void> {
    if (job.name !== ANALYZE_TURN_JOB) {
      return;
    }

    try {
      await this.analyzeTurnService.analyzeTurn(job.data.turnId, job);
    } catch (error) {
      if (error instanceof AnalyzeTurnDependencyPendingError) {
        await job.moveToDelayed(
          Date.now() + ANALYZE_TURN_DEPENDENCY_RETRY_DELAY_MS,
          token,
        );
        throw new DelayedError();
      }
      this.logger.error(
        `Analyze turn job failed. jobId=${String(job.id)} turnId=${job.data.turnId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
