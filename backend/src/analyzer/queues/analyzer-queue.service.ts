import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  ANALYZER_QUEUE,
  ANALYZE_TURN_JOB,
  ANALYZE_TURN_JOB_ATTEMPTS,
  ANALYZE_TURN_JOB_BACKOFF_DELAY_MS,
} from "../constants";
import { AnalyzeTurnJobData } from "./analyzer-job.data";

@Injectable()
export class AnalyzerQueueService {
  constructor(
    @InjectQueue(ANALYZER_QUEUE)
    private readonly analyzerQueue: Queue<AnalyzeTurnJobData>,
  ) {}

  async enqueueAnalyzeTurn(turnId: string): Promise<string> {
    const job = await this.analyzerQueue.add(
      ANALYZE_TURN_JOB,
      { turnId },
      {
        jobId: `${ANALYZE_TURN_JOB}-${turnId}`,
        attempts: ANALYZE_TURN_JOB_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: ANALYZE_TURN_JOB_BACKOFF_DELAY_MS,
        },
      },
    );

    return String(job.id);
  }
}
