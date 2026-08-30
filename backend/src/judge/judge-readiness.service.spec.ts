import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { DebateStatus, JudgeTaskStatus } from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { JudgeTaskEntity } from "../debates/entities/judge-task.entity";
import { JudgeQueueService } from "./judge-queue.service";
import { JudgeReadinessService } from "./judge-readiness.service";

class CountQueryBuilder {
  constructor(private readonly count: number) {}
  where(): this {
    return this;
  }
  andWhere(): this {
    return this;
  }
  innerJoin(): this {
    return this;
  }
  leftJoin(): this {
    return this;
  }
  async getCount(): Promise<number> {
    return this.count;
  }
}

describe("JudgeReadinessService", () => {
  function createContext(incompleteTurns = 0) {
    const inserts: Array<{ entity: unknown; values: unknown }> = [];
    const updates: Array<{ entity: unknown; values: unknown }> = [];
    const manager = {
      findOne: jest.fn().mockImplementation(async (entity) => {
        if (entity === DebateEntity) {
          return {
            id: "debate-1",
            status: DebateStatus.DEBATE_FINALIZED,
            rebuttalQuestionRounds: 1,
          };
        }
        if (entity === JudgeTaskEntity) return null;
        return null;
      }),
      count: jest.fn().mockImplementation(async (entity) => {
        if (entity === DebateEntity) return 0;
        return entity.name === "DebateTurnEntity" ? 6 : 0;
      }),
      getRepository: jest.fn().mockImplementation((entity) => ({
        createQueryBuilder: () =>
          new CountQueryBuilder(
            entity.name === "DebateTurnEntity" ? incompleteTurns : 0,
          ),
      })),
      insert: jest.fn().mockImplementation(async (entity, values) => {
        inserts.push({ entity, values });
      }),
      update: jest
        .fn()
        .mockImplementation(async (entity, _criteria, values) => {
          updates.push({ entity, values });
          return { affected: 1 };
        }),
    };
    const dataSource = {
      transaction: jest.fn(async (work) => work(manager)),
    };
    const queueService = {
      enqueueTask: jest.fn().mockResolvedValue("judge-job-1"),
    };
    const service = new JudgeReadinessService(
      dataSource as unknown as DataSource,
      queueService as unknown as JudgeQueueService,
      new ConfigService(),
    );
    return { service, queueService, inserts, updates };
  }

  it("creates one pending task and only enqueues Judge when prerequisites are complete", async () => {
    const { service, queueService, inserts, updates } = createContext();

    await service.tryStartJudge("debate-1");

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      entity: JudgeTaskEntity,
      values: expect.objectContaining({
        debateId: "debate-1",
        status: JudgeTaskStatus.PENDING,
        attemptCount: 0,
      }),
    });
    expect(updates).toContainEqual({
      entity: DebateEntity,
      values: expect.objectContaining({ status: DebateStatus.JUDGING }),
    });
    expect(queueService.enqueueTask).toHaveBeenCalledWith(expect.any(String));
  });

  it("does not create or enqueue a Judge task while analysis is incomplete", async () => {
    const { service, queueService, inserts } = createContext(1);

    await service.tryStartJudge("debate-1");

    expect(inserts).toHaveLength(0);
    expect(queueService.enqueueTask).not.toHaveBeenCalled();
  });
});
