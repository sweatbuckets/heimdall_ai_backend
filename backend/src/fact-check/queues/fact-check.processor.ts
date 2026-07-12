import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { FactCheckBatchTaskService } from "../fact-check-batch-task.service";
import {
  FACT_CHECK_BATCH_JOB,
  FACT_CHECK_QUEUE,
  FactCheckJobData,
} from "./fact-check.constants";

@Processor(FACT_CHECK_QUEUE)
export class FactCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(FactCheckProcessor.name);

  constructor(
    private readonly factCheckBatchTaskService: FactCheckBatchTaskService,
  ) {
    super();
  }

  async process(job: Job<FactCheckJobData>): Promise<void> {
    if (job.name !== FACT_CHECK_BATCH_JOB) {
      return;
    }

    try {
      await this.factCheckBatchTaskService.process(
        job.data.factCheckBatchTaskId,
        job,
      );
    } catch (error) {
      this.logger.error(
        `Fact check batch job failed. jobId=${String(job.id)} taskId=${job.data.factCheckBatchTaskId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
