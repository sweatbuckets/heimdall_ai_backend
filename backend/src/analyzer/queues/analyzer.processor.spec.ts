import { DelayedError, Job } from "bullmq";
import { AnalyzeTurnService } from "../analyze-turn.service";
import {
  ANALYZE_ROUND_DEPENDENCY_RETRY_DELAY_MS,
  ANALYZE_ROUND_JOB,
} from "../constants";
import { AnalyzeTurnDependencyPendingError } from "../errors/analyzer.errors";
import { AnalyzeRoundJobData } from "./analyzer-job.data";
import { AnalyzerProcessor } from "./analyzer.processor";
import { DebatePhase } from "../../debates/domain/debate.enums";
import { AnalyzerQueueService } from "./analyzer-queue.service";

describe("AnalyzerProcessor", () => {
  it("delays a job without consuming an attempt while an earlier turn is incomplete", async () => {
    const analyzeTurn = jest
      .fn()
      .mockRejectedValue(new AnalyzeTurnDependencyPendingError("turn-2"));
    const processor = new AnalyzerProcessor(
      { analyzeTurn } as unknown as AnalyzeTurnService,
      {
        enqueueNextReadyRound: jest.fn(),
      } as unknown as AnalyzerQueueService,
    );
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    const job = {
      name: ANALYZE_ROUND_JOB,
      data: {
        anchorTurnId: "turn-1",
        debateId: "debate-1",
        phase: DebatePhase.OPENING,
        round: 1,
      },
      moveToDelayed,
    } as unknown as Job<AnalyzeRoundJobData>;
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);

    await expect(processor.process(job, "worker-token")).rejects.toThrow(
      DelayedError,
    );

    expect(moveToDelayed).toHaveBeenCalledWith(
      1000 + ANALYZE_ROUND_DEPENDENCY_RETRY_DELAY_MS,
      "worker-token",
    );
    now.mockRestore();
  });

  it("enqueues the next ready round after a round completes", async () => {
    const analyzeTurn = jest.fn().mockResolvedValue({
      skipped: false,
      componentCount: 2,
    });
    const enqueueNextReadyRound = jest.fn().mockResolvedValue("next-job");
    const processor = new AnalyzerProcessor(
      { analyzeTurn } as unknown as AnalyzeTurnService,
      { enqueueNextReadyRound } as unknown as AnalyzerQueueService,
    );
    const job = {
      name: ANALYZE_ROUND_JOB,
      data: {
        anchorTurnId: "turn-1",
        debateId: "debate-1",
        phase: DebatePhase.OPENING,
        round: 1,
      },
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job<AnalyzeRoundJobData>;

    await processor.process(job);

    expect(analyzeTurn).toHaveBeenCalledWith("turn-1", job);
    expect(enqueueNextReadyRound).toHaveBeenCalledWith("turn-1");
  });
});
