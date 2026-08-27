import { DelayedError, Job } from "bullmq";
import { AnalyzeTurnService } from "../analyze-turn.service";
import { ANALYZE_TURN_DEPENDENCY_RETRY_DELAY_MS } from "../constants";
import { AnalyzeTurnDependencyPendingError } from "../errors/analyzer.errors";
import { AnalyzeTurnJobData } from "./analyzer-job.data";
import { AnalyzerProcessor } from "./analyzer.processor";

describe("AnalyzerProcessor", () => {
  it("delays a job without consuming an attempt while an earlier turn is incomplete", async () => {
    const analyzeTurn = jest
      .fn()
      .mockRejectedValue(new AnalyzeTurnDependencyPendingError("turn-2"));
    const processor = new AnalyzerProcessor({
      analyzeTurn,
    } as unknown as AnalyzeTurnService);
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    const job = {
      name: "analyze-turn",
      data: { turnId: "turn-2" },
      moveToDelayed,
    } as unknown as Job<AnalyzeTurnJobData>;
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);

    await expect(processor.process(job, "worker-token")).rejects.toThrow(
      DelayedError,
    );

    expect(moveToDelayed).toHaveBeenCalledWith(
      1000 + ANALYZE_TURN_DEPENDENCY_RETRY_DELAY_MS,
      "worker-token",
    );
    now.mockRestore();
  });
});
