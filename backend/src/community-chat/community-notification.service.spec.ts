import { EntityManager } from "typeorm";
import { CommunityNotificationService } from "./community-notification.service";
import { CommunityMessageType } from "./entities/community-message.entity";
import {
  CommunityDebateIntent,
  CommunityMemberRole,
} from "./domain/community-chat.enums";

describe("CommunityNotificationService", () => {
  const manager = {
    insert: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityManager;

  beforeEach(() => jest.clearAllMocks());

  it("stores a debate-start notice with both speaker names", async () => {
    const service = new CommunityNotificationService();

    const message = await service.createDebateStarted(
      manager,
      "community-1",
      "debate-1",
      "윤호",
      "현우",
    );

    expect(manager.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        communityId: "community-1",
        debateId: "debate-1",
        authorId: null,
        type: CommunityMessageType.DEBATE_STARTED,
      }),
    );
    expect(message.text).toBe("윤호님과 현우님이 토론을 시작했습니다.");
  });

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

  it("stores a system notice when the debate time limit expires", async () => {
    const service = new CommunityNotificationService();

    const message = await service.createDebateTimeout(
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
        type: CommunityMessageType.DEBATE_TIMEOUT,
      }),
    );
    expect(message.text).toBe(
      "토론 제한 시간이 초과되어 토론이 종료되었습니다.",
    );
  });

  it("publishes a member debate-intent change to realtime listeners", () => {
    const service = new CommunityNotificationService();
    const listener = jest.fn();
    service.subscribeDebateIntent(listener);
    const notice = {
      communityId: "community-1",
      member: {
        id: "member-1",
        displayName: "현우",
        profileImageUrl: null,
        role: CommunityMemberRole.MEMBER,
        debateIntent: CommunityDebateIntent.OPEN_TO_DEBATE,
        joinedAt: "2026-08-24T08:00:00.000Z",
      },
    };

    service.publishDebateIntent(notice);

    expect(listener).toHaveBeenCalledWith(notice);
  });
});
