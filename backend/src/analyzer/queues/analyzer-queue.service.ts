import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ANALYZER_QUEUE, ANALYZE_TURN_JOB } from "../constants";
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
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );

    return String(job.id);
  }
}
