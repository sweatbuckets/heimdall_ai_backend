import { AddressInfo } from "node:net";
import { ConfigService } from "@nestjs/config";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { AuthService } from "../auth/auth.service";
import { CommunityChatService } from "../community-chat/community-chat.service";
import { CommunityNotificationService } from "../community-chat/community-notification.service";
import { CommunityMessageDto } from "../community-chat/dto/community-chat.dto";
import { CommunityMessageType } from "../community-chat/entities/community-message.entity";
import { DebateChatService } from "./debate-chat.service";
import { DebateChatWebSocketServer } from "./debate-chat.websocket-server";

describe("community chat WebSocket acknowledgements", () => {
  let gateway: DebateChatWebSocketServer;
  let sendMessage: jest.Mock;
  let publishNotification: (message: CommunityMessageDto) => void;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    sendMessage = jest.fn().mockResolvedValue({
      created: true,
      message: {
        id: "message-1",
        communityId: "community-1",
        clientMessageId: "client-1",
        authorId: "member-1",
        authorName: "회원",
        text: "메시지",
        createdAt: "2026-08-23T08:00:00.000Z",
      },
    });
    const communityChatService = {
      joinCommunity: jest.fn().mockResolvedValue(undefined),
      listMessages: jest.fn().mockResolvedValue([]),
      listOpinions: jest.fn().mockResolvedValue([]),
      sendMessage,
      saveOpinion: jest.fn().mockResolvedValue({
        id: "opinion-1",
        communityId: "community-1",
        authorId: "member-1",
        authorName: "회원",
        claim: "주장",
        reasons: ["근거"],
        createdAt: "2026-08-23T08:00:00.000Z",
        updatedAt: "2026-08-23T08:00:00.000Z",
      }),
    };

    gateway = new DebateChatWebSocketServer(
      { get: jest.fn().mockReturnValue(0) } as unknown as ConfigService,
      {} as DebateChatService,
      {
        verifyAccessToken: jest
          .fn()
          .mockResolvedValue({ memberId: "member-1" }),
      } as unknown as AuthService,
      communityChatService as unknown as CommunityChatService,
      {
        subscribe: jest.fn().mockImplementation((listener) => {
          publishNotification = listener;
          return jest.fn();
        }),
      } as unknown as CommunityNotificationService,
    );
    gateway.onApplicationBootstrap();
    await waitForListening(rawServer(gateway));
  });

  afterEach(() => {
    for (const client of clients) client.close();
    clients.length = 0;
    gateway.onApplicationShutdown();
  });

  it("ACKs the sender after storage and broadcasts events only to peers", async () => {
    const sender = await connect(gateway);
    const peer = await connect(gateway);

    const messageAck = nextEvent(sender, "community.message.ack");
    const messageCreated = nextEvent(peer, "message.created");
    sender.send(
      JSON.stringify({
        id: "command-1",
        type: "message.send",
        communityId: "community-1",
        clientMessageId: "client-1",
        payload: { text: "메시지" },
      }),
    );

    await expect(messageAck).resolves.toMatchObject({
      commandId: "command-1",
      clientMessageId: "client-1",
      status: "STORED",
      message: { id: "message-1" },
    });
    await expect(messageCreated).resolves.toMatchObject({
      message: { id: "message-1" },
    });

    const opinionAck = nextEvent(sender, "community.opinion.ack");
    const opinionSubmitted = nextEvent(peer, "opinion.submitted");
    sender.send(
      JSON.stringify({
        id: "command-2",
        type: "opinion.submit",
        communityId: "community-1",
        payload: { claim: "주장", reasons: ["근거"] },
      }),
    );

    await expect(opinionAck).resolves.toMatchObject({
      commandId: "command-2",
      status: "STORED",
      opinion: { id: "opinion-1" },
    });
    await expect(opinionSubmitted).resolves.toMatchObject({
      opinion: { id: "opinion-1" },
    });
  });

  it("returns a command-correlated error when storage fails", async () => {
    sendMessage.mockRejectedValueOnce(new Error("Community message failed."));
    const sender = await connect(gateway);
    const errorEvent = nextEvent(sender, "error");

    sender.send(
      JSON.stringify({
        id: "failed-command",
        type: "message.send",
        communityId: "community-1",
        clientMessageId: "failed-client-message",
        payload: { text: "실패할 메시지" },
      }),
    );

    await expect(errorEvent).resolves.toMatchObject({
      commandId: "failed-command",
      message: "Community message failed.",
    });
  });

  it("broadcasts a completed debate result card to community clients", async () => {
    const client = await connect(gateway);
    const debateEnded = nextEvent(client, "debate.ended");
    const messageCreated = nextEvent(client, "message.created");

    publishNotification({
      id: "result-message-1",
      communityId: "community-1",
      clientMessageId: "debate_result:debate-1",
      authorId: "system",
      authorName: "헤임달",
      text: "토론이 종료되었습니다. 결과와 팩트체크를 확인해 보세요.",
      messageType: CommunityMessageType.DEBATE_RESULT,
      debateId: "debate-1",
      createdAt: "2026-08-23T08:00:00.000Z",
    });

    await expect(debateEnded).resolves.toMatchObject({
      debateId: "debate-1",
      status: "COMPLETED",
    });
    await expect(messageCreated).resolves.toMatchObject({
      message: {
        id: "result-message-1",
        messageType: "DEBATE_RESULT",
        debateId: "debate-1",
      },
    });
  });

  async function connect(server: DebateChatWebSocketServer) {
    const address = rawServer(server).address() as AddressInfo;
    const client = new WebSocket(
      `ws://127.0.0.1:${address.port}/communities/community-1/chat`,
      { headers: { Authorization: "Bearer access-token" } },
    );
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    return client;
  }
});

function rawServer(gateway: DebateChatWebSocketServer): WebSocketServer {
  return (
    gateway as unknown as {
      server: WebSocketServer;
    }
  ).server;
}

async function waitForListening(server: WebSocketServer): Promise<void> {
  if (server.address() !== null) return;
  await new Promise<void>((resolve) => server.once("listening", resolve));
}

function nextEvent(
  socket: WebSocket,
  expectedType: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${expectedType}.`)),
      2000,
    );
    const listener = (data: RawData) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      if (event.type !== expectedType) return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(event);
    };
    socket.on("message", listener);
  });
}
