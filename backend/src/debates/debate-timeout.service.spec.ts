import { DataSource, EntityManager } from "typeorm";
import { DebateStatus } from "./domain/debate.enums";
import { DebateEntity } from "./entities/debate.entity";
import { DebateTimeoutService } from "./debate-timeout.service";

describe("DebateTimeoutService", () => {
  const manager = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(
      async (work: (entityManager: EntityManager) => Promise<unknown>) =>
        work(manager),
    ),
  } as unknown as DataSource;
  const analyzerQueueService = {
    cancelAnalyzeTurn: jest.fn().mockResolvedValue(undefined),
  };
  const cancellationService = { cancelDebate: jest.fn() };
  const debateChatService = {
    clearDebateDrafts: jest.fn().mockResolvedValue(undefined),
  };
  const websocketServer = { publishDebateEnded: jest.fn() };
  const timeoutNotification = {
    id: "timeout-message",
    communityId: "community-id",
  };
  const communityNotificationService = {
    createDebateTimeout: jest.fn().mockResolvedValue(timeoutNotification),
    publish: jest.fn(),
  };
  const factCheckQueue = { getJob: jest.fn() };

  const service = new DebateTimeoutService(
    dataSource,
    analyzerQueueService as never,
    cancellationService as never,
    debateChatService as never,
    websocketServer as never,
    communityNotificationService as never,
    factCheckQueue as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (manager.find as jest.Mock).mockResolvedValue([]);
    (manager.update as jest.Mock).mockResolvedValue({ affected: 1 });
  });

  it.each([DebateStatus.DEBATE_FINALIZED, DebateStatus.JUDGING])(
    "force-terminates an overdue %s debate",
    async (status) => {
      (manager.findOne as jest.Mock).mockResolvedValue({
        id: "debate-id",
        communityId: "community-id",
        status,
        startedAt: new Date("2000-01-01T00:00:00.000Z"),
        rebuttalQuestionRounds: 1,
      } satisfies Partial<DebateEntity>);

      const terminated = await service.expireDebate("debate-id");

      expect(terminated).toBe(true);
      expect(cancellationService.cancelDebate).toHaveBeenCalledWith(
        "debate-id",
      );
      expect(websocketServer.publishDebateEnded).toHaveBeenCalledWith(
        "community-id",
        "debate-id",
        DebateStatus.FAILED,
        "TOTAL_TIME_EXPIRED",
      );
      expect(communityNotificationService.publish).toHaveBeenCalledWith(
        timeoutNotification,
      );
    },
  );
});
