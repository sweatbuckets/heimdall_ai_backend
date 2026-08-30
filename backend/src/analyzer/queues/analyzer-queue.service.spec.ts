import { Queue } from "bullmq";
import { DataSource } from "typeorm";
import { ANALYZE_ROUND_JOB } from "../constants";
import { AnalyzerQueueService } from "./analyzer-queue.service";
import { AnalyzeRoundJobData } from "./analyzer-job.data";
import { DebatePhase } from "../../debates/domain/debate.enums";
import { DebateTurnAnalysisStatus } from "../../debates/domain/debate.enums";

describe("AnalyzerQueueService", () => {
  const turnId = "11111111-1111-4111-8111-111111111111";
  const secondTurnId = "22222222-2222-4222-8222-222222222222";
  const debateId = "33333333-3333-4333-8333-333333333333";

  function createService(roundTurnCount: number, incompletePredecessors = 0) {
    const add = jest.fn().mockResolvedValue({ id: "job-1" });
    const queue = { add } as unknown as Queue<AnalyzeRoundJobData>;
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        id: turnId,
        debateId,
        phase: DebatePhase.OPENING,
        round: 1,
      }),
      find: jest.fn().mockResolvedValue(
        [
          {
            id: turnId,
            sequence: 1,
            analysisStatus: DebateTurnAnalysisStatus.PENDING,
          },
          {
            id: secondTurnId,
            sequence: 2,
            analysisStatus: DebateTurnAnalysisStatus.PENDING,
          },
        ].slice(0, roundTurnCount),
      ),
      count: jest.fn().mockResolvedValue(incompletePredecessors),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as DataSource;
    return { service: new AnalyzerQueueService(queue, dataSource), add };
  }

  it("does not enqueue until both turns in the round exist", async () => {
    const { service, add } = createService(1);

    await expect(service.enqueueAnalyzeTurn(turnId)).resolves.toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it("queues one BullMQ job keyed by debate phase and round", async () => {
    const { service, add } = createService(2);

    await service.enqueueAnalyzeTurn(secondTurnId);

    expect(add).toHaveBeenCalledWith(
      ANALYZE_ROUND_JOB,
      {
        anchorTurnId: turnId,
        debateId,
        phase: DebatePhase.OPENING,
        round: 1,
      },
      expect.objectContaining({
        jobId: `${ANALYZE_ROUND_JOB}-${debateId}-opening-1`,
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 5000,
          jitter: 0.5,
        },
      }),
    );
    expect(add.mock.calls[0][2].jobId).not.toContain(":");
  });

  it("does not enqueue a later round before its predecessor completes", async () => {
    const { service, add } = createService(2, 1);

    await expect(service.enqueueAnalyzeTurn(secondTurnId)).resolves.toBeNull();
    expect(add).not.toHaveBeenCalled();
  });
});
