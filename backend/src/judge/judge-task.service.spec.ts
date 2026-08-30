import { Job } from "bullmq";
import { DataSource } from "typeorm";
import { JudgeTaskStatus } from "../debates/domain/debate.enums";
import { JudgeTaskEntity } from "../debates/entities/judge-task.entity";
import { JudgeTaskService } from "./judge-task.service";
import { JudgeService } from "./judge.service";
import { JudgeJobData } from "./queues/judge.constants";

class ClaimQueryBuilder {
  constructor(private readonly affected: number) {}
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
    return { affected: this.affected };
  }
}

describe("JudgeTaskService", () => {
  function createService(judgeError?: Error) {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const task = {
      id: "judge-task-1",
      debateId: "debate-1",
      status: JudgeTaskStatus.PROCESSING,
    };
    const dataSource = {
      createQueryBuilder: () => new ClaimQueryBuilder(1),
      getRepository: (entity: unknown) => {
        if (entity !== JudgeTaskEntity) {
          return { count: jest.fn().mockResolvedValue(0) };
        }
        return {
          findOne: jest.fn().mockResolvedValue(task),
          update,
        };
      },
    };
    const judgeService = {
      judgeDebate: judgeError
        ? jest.fn().mockRejectedValue(judgeError)
        : jest.fn().mockResolvedValue({
            debateId: "debate-1",
            judgmentResultId: "result-1",
          }),
    };
    return {
      service: new JudgeTaskService(
        dataSource as unknown as DataSource,
        judgeService as unknown as JudgeService,
      ),
      judgeService,
      update,
    };
  }

  it("claims a task and delegates the only Judge execution to JudgeService", async () => {
    const { service, judgeService } = createService();

    await service.process("judge-task-1");

    expect(judgeService.judgeDebate).toHaveBeenCalledTimes(1);
    expect(judgeService.judgeDebate).toHaveBeenCalledWith(
      "debate-1",
      "judge-task-1",
    );
  });

  it("returns the task to pending before the final BullMQ attempt", async () => {
    const { service, update } = createService(new Error("temporary failure"));
    const job = {
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as Job<JudgeJobData>;

    await expect(service.process("judge-task-1", job)).rejects.toThrow(
      "temporary failure",
    );

    expect(update).toHaveBeenCalledWith(
      { id: "judge-task-1", status: JudgeTaskStatus.PROCESSING },
      expect.objectContaining({ status: JudgeTaskStatus.PENDING }),
    );
  });

  it("marks the task failed on the final BullMQ attempt", async () => {
    const { service, update } = createService(new Error("final failure"));
    const job = {
      attemptsMade: 1,
      opts: { attempts: 2 },
    } as Job<JudgeJobData>;

    await expect(service.process("judge-task-1", job)).rejects.toThrow(
      "final failure",
    );

    expect(update).toHaveBeenCalledWith(
      { id: "judge-task-1", status: JudgeTaskStatus.PROCESSING },
      expect.objectContaining({ status: JudgeTaskStatus.FAILED }),
    );
  });
});
