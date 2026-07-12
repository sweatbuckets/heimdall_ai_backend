import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { DataSource } from "typeorm";
import { FactCheckBatchTaskStatus } from "../debates/domain/debate.enums";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";
import { FactCheckerAiService } from "./fact-checker-ai.service";
import { FactCheckInputAssembler } from "./fact-check-input.assembler";
import { FactCheckBatchTaskService } from "./fact-check-batch-task.service";

interface UpdateExecutionResult {
  affected: number;
}

class MockUpdateQueryBuilder {
  constructor(private readonly affected: number) {}

  update(_entity: unknown): this {
    return this;
  }

  set(_values: object): this {
    return this;
  }

  where(_condition: string, _parameters?: object): this {
    return this;
  }

  andWhere(_condition: string, _parameters?: object): this {
    return this;
  }

  async execute(): Promise<UpdateExecutionResult> {
    return { affected: this.affected };
  }
}

class MockRepository<T extends object> {
  constructor(private readonly findOneResult: T | null) {}

  async findOne(_options: object): Promise<T | null> {
    return this.findOneResult;
  }
}

class MockDataSource {
  public readonly queryBuilders: MockUpdateQueryBuilder[];

  constructor(
    affectedResults: number[],
    private readonly task: Partial<FactCheckBatchTaskEntity> | null,
  ) {
    this.queryBuilders = affectedResults.map(
      (affected) => new MockUpdateQueryBuilder(affected),
    );
  }

  createQueryBuilder(): MockUpdateQueryBuilder {
    const queryBuilder = this.queryBuilders.shift();

    if (!queryBuilder) {
      throw new Error("Unexpected query builder call.");
    }

    return queryBuilder;
  }

  getRepository(entity: unknown): MockRepository<object> {
    if (entity !== FactCheckBatchTaskEntity) {
      throw new Error("Unexpected repository entity.");
    }

    return new MockRepository(this.task);
  }
}

class MockConfigService {
  get<T>(_key: string, defaultValue: T): T {
    return defaultValue;
  }
}

describe("FactCheckBatchTaskService", () => {
  const taskId = "task-1";

  function createService(dataSource: MockDataSource): {
    service: FactCheckBatchTaskService;
    assembler: { assemble: jest.Mock };
    aiService: { check: jest.Mock };
  } {
    const assembler = {
      assemble: jest.fn(),
    };
    const aiService = {
      check: jest.fn(),
    };
    const queue = {
      add: jest.fn(),
    };

    return {
      service: new FactCheckBatchTaskService(
        dataSource as unknown as DataSource,
        assembler as unknown as FactCheckInputAssembler,
        aiService as unknown as FactCheckerAiService,
        new MockConfigService() as unknown as ConfigService,
        queue as unknown as Queue,
      ),
      assembler,
      aiService,
    };
  }

  it("ignores duplicate jobs for a COMPLETED task", async () => {
    const dataSource = new MockDataSource([0], {
      id: taskId,
      status: FactCheckBatchTaskStatus.COMPLETED,
    });
    const { service, assembler, aiService } = createService(dataSource);

    await expect(service.process(taskId)).resolves.toBeUndefined();
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(aiService.check).not.toHaveBeenCalled();
  });

  it("ignores duplicate jobs while another worker is PROCESSING", async () => {
    const dataSource = new MockDataSource([0], {
      id: taskId,
      status: FactCheckBatchTaskStatus.PROCESSING,
    });
    const { service, assembler, aiService } = createService(dataSource);

    await expect(service.process(taskId)).resolves.toBeUndefined();
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(aiService.check).not.toHaveBeenCalled();
  });
});
