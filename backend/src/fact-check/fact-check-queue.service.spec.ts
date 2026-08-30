import { Job, Queue } from "bullmq";
import { DataSource } from "typeorm";
import { FactCheckStage } from "../debates/domain/debate.enums";
import { FactCheckQueueService } from "./fact-check-queue.service";
import {
  FACT_CHECK_GROUNDING_JOB,
  FACT_CHECK_SYNTHESIS_JOB,
  FactCheckStageJobData,
} from "./queues/fact-check.constants";

class MockUpdateQueryBuilder {
  update(): this {
    return this;
  }
  set(): this {
    return this;
  }
  where(): this {
    return this;
  }
  andWhere(): this {
    return this;
  }
  async execute(): Promise<{ affected: number }> {
    return { affected: 1 };
  }
}

function createQueue() {
  return {
    getJob: jest.fn().mockResolvedValue(null),
    add: jest.fn().mockImplementation(async (_name, _data, options) => ({
      id: options.jobId,
    })),
  };
}

describe("FactCheckQueueService", () => {
  it("routes grounding and synthesis tasks to separate queues", async () => {
    const groundingQueue = createQueue();
    const synthesisQueue = createQueue();
    const dataSource = {
      createQueryBuilder: () => new MockUpdateQueryBuilder(),
    };
    const service = new FactCheckQueueService(
      dataSource as unknown as DataSource,
      groundingQueue as unknown as Queue<FactCheckStageJobData>,
      synthesisQueue as unknown as Queue<FactCheckStageJobData>,
    );

    await service.enqueueGroundingTask("grounding-task-1");
    await service.enqueueSynthesisTask("synthesis-task-1");

    expect(groundingQueue.add).toHaveBeenCalledTimes(1);
    expect(groundingQueue.add).toHaveBeenCalledWith(
      FACT_CHECK_GROUNDING_JOB,
      { taskId: "grounding-task-1" },
      expect.objectContaining({
        jobId: "grounding-task-1",
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 5000,
          jitter: 0.5,
        },
      }),
    );
    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    expect(synthesisQueue.add).toHaveBeenCalledWith(
      FACT_CHECK_SYNTHESIS_JOB,
      { taskId: "synthesis-task-1" },
      expect.objectContaining({
        jobId: "synthesis-task-1",
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 5000,
          jitter: 0.5,
        },
      }),
    );
  });

  it("reuses an active task job instead of adding a duplicate", async () => {
    const existingJob = {
      id: "grounding-task-1",
      getState: jest.fn().mockResolvedValue("active"),
    } as unknown as Job<FactCheckStageJobData>;
    const groundingQueue = createQueue();
    groundingQueue.getJob.mockResolvedValue(existingJob);
    const dataSource = {
      createQueryBuilder: () => new MockUpdateQueryBuilder(),
    };
    const service = new FactCheckQueueService(
      dataSource as unknown as DataSource,
      groundingQueue as unknown as Queue<FactCheckStageJobData>,
      createQueue() as unknown as Queue<FactCheckStageJobData>,
    );

    await service.enqueueGroundingTask("grounding-task-1");

    expect(groundingQueue.add).not.toHaveBeenCalled();
    expect(existingJob.getState).toHaveBeenCalledTimes(1);
  });

  it("selects the queue from the persisted task stage during recovery", async () => {
    const groundingQueue = createQueue();
    const synthesisQueue = createQueue();
    const dataSource = {
      getRepository: () => ({
        find: jest.fn().mockResolvedValue([
          { id: "grounding-task-1", stage: FactCheckStage.GROUNDING },
          { id: "synthesis-task-1", stage: FactCheckStage.SYNTHESIS },
        ]),
      }),
      createQueryBuilder: () => new MockUpdateQueryBuilder(),
    };
    const service = new FactCheckQueueService(
      dataSource as unknown as DataSource,
      groundingQueue as unknown as Queue<FactCheckStageJobData>,
      synthesisQueue as unknown as Queue<FactCheckStageJobData>,
    );

    await expect(service.enqueuePendingTasks()).resolves.toBe(2);

    expect(groundingQueue.add).toHaveBeenCalledTimes(1);
    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
  });
});
