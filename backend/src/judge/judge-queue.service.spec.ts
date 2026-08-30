import { Queue } from "bullmq";
import { DataSource } from "typeorm";
import { JudgeTaskStatus } from "../debates/domain/debate.enums";
import { JudgeQueueService } from "./judge-queue.service";
import { JUDGE_JOB, JudgeJobData } from "./queues/judge.constants";

class MockUpdateQueryBuilder {
  readonly sets: unknown[] = [];
  readonly conditions: string[] = [];

  update(): this {
    return this;
  }
  set(values: unknown): this {
    this.sets.push(values);
    return this;
  }
  where(condition: string): this {
    this.conditions.push(condition);
    return this;
  }
  andWhere(condition: string): this {
    this.conditions.push(condition);
    return this;
  }
  async execute(): Promise<{ affected: number }> {
    return { affected: 1 };
  }
}

describe("JudgeQueueService", () => {
  it("enqueues one BullMQ retry and persists the job id", async () => {
    const queryBuilder = new MockUpdateQueryBuilder();
    const queue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockResolvedValue({ id: "judge-task-1" }),
    };
    const service = new JudgeQueueService(
      {
        createQueryBuilder: () => queryBuilder,
      } as unknown as DataSource,
      queue as unknown as Queue<JudgeJobData>,
    );

    await service.enqueueTask("judge-task-1");

    expect(queue.add).toHaveBeenCalledWith(
      JUDGE_JOB,
      { taskId: "judge-task-1" },
      expect.objectContaining({
        jobId: "judge-task-1",
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 5000,
          jitter: 0.5,
        },
      }),
    );
    expect(queryBuilder.sets).toContainEqual({ bullMqJobId: "judge-task-1" });
  });

  it("resets only stale PROCESSING tasks to PENDING", async () => {
    const queryBuilder = new MockUpdateQueryBuilder();
    const service = new JudgeQueueService(
      {
        createQueryBuilder: () => queryBuilder,
      } as unknown as DataSource,
      {} as Queue<JudgeJobData>,
    );

    await expect(
      service.resetStaleProcessingTasks(new Date("2026-01-01T00:00:00Z")),
    ).resolves.toBe(1);

    expect(queryBuilder.sets).toContainEqual(
      expect.objectContaining({
        status: JudgeTaskStatus.PENDING,
        processingStartedAt: null,
      }),
    );
    expect(queryBuilder.conditions).toContain("status = :status");
    expect(queryBuilder.conditions).toContain(
      "processing_started_at < :staleBefore",
    );
  });
});
