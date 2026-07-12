import { Queue } from "bullmq";
import { ANALYZE_TURN_JOB } from "../constants";
import { AnalyzerQueueService } from "./analyzer-queue.service";
import { AnalyzeTurnJobData } from "./analyzer-job.data";

describe("AnalyzerQueueService", () => {
  it("uses a BullMQ-safe custom jobId", async () => {
    const add = jest.fn().mockResolvedValue({ id: "job-1" });
    const queue = { add } as unknown as Queue<AnalyzeTurnJobData>;
    const service = new AnalyzerQueueService(queue);
    const turnId = "11111111-1111-4111-8111-111111111111";

    await service.enqueueAnalyzeTurn(turnId);

    expect(add).toHaveBeenCalledWith(
      ANALYZE_TURN_JOB,
      { turnId },
      expect.objectContaining({
        jobId: `${ANALYZE_TURN_JOB}-${turnId}`,
      }),
    );
    expect(add.mock.calls[0][2].jobId).not.toContain(":");
  });
});
