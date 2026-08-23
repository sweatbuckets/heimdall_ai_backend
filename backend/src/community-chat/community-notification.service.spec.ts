import { EntityManager } from "typeorm";
import { CommunityNotificationService } from "./community-notification.service";
import { CommunityMessageType } from "./entities/community-message.entity";

describe("CommunityNotificationService", () => {
  const manager = {
    insert: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityManager;

  beforeEach(() => jest.clearAllMocks());

  it("stores a result card linked to the completed debate", async () => {
    const service = new CommunityNotificationService();

    const message = await service.createDebateResult(
      manager,
      "community-1",
      "debate-1",
    );

    expect(manager.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        communityId: "community-1",
        debateId: "debate-1",
        authorId: null,
        type: CommunityMessageType.DEBATE_RESULT,
      }),
    );
    expect(message.text).toContain("결과와 팩트체크");
  });

  it("includes the forfeiting username and publishes the stored notice", async () => {
    const service = new CommunityNotificationService();
    const listener = jest.fn();
    service.subscribe(listener);

    const message = await service.createDebateForfeit(
      manager,
      "community-1",
      "debate-1",
      "윤호",
    );
    service.publish(message);

    expect(message.messageType).toBe(CommunityMessageType.DEBATE_FORFEIT);
    expect(message.text).toBe("윤호님이 기권하여 토론이 종료되었습니다.");
    expect(listener).toHaveBeenCalledWith(message);
  });
});
