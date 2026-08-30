import { randomUUID } from "node:crypto";
import { IncomingMessage } from "node:http";
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "../auth/auth.service";
import { extractBearerToken } from "../auth/jwt-auth.guard";
import { CommunityChatService } from "../community-chat/community-chat.service";
import { CommunityNotificationService } from "../community-chat/community-notification.service";
import { CommunityMessageType } from "../community-chat/entities/community-message.entity";
import { DebateStatus } from "../debates/domain/debate.enums";
import {
  COMMUNITY_COMMAND_STATUS_DUPLICATE,
  COMMUNITY_COMMAND_STATUS_STORED,
  COMMUNITY_MESSAGE_ACK_EVENT,
  COMMUNITY_OPINION_ACK_EVENT,
  CommunityMessageAckEvent,
  CommunityMessageCreatedEvent,
  CommunityOpinionAckEvent,
  CommunityOpinionSubmittedEvent,
} from "../community-chat/dto/community-chat.dto";
import { validateCommunityCommand } from "../community-chat/validators/community-chat.validator";
import { RawData, WebSocket, WebSocketServer } from "ws";
import {
  DEBATE_CHAT_ERROR_EVENT,
  DEBATE_CONNECTION_RESTORED_EVENT,
  DEBATE_TURN_FINALIZE_COMMAND,
  DEBATE_TURN_FINALIZED_EVENT,
  DEBATE_TURN_MESSAGE_ACK_EVENT,
  DEBATE_TURN_MESSAGE_APPEND_STATUS_APPENDED,
  DEBATE_TURN_MESSAGE_CREATED_EVENT,
  DEBATE_TURN_MESSAGE_SEND_COMMAND,
  DEBATE_TURN_SEND_COMMAND,
  DebateChatErrorEvent,
  DebateChatServerEvent,
} from "./dto/debate-chat.dto";
import {
  DebateChatInputError,
  DebateChatStateError,
} from "./errors/debate-chat.errors";
import { DebateChatService } from "./debate-chat.service";
import { parseDebateChatCommand } from "./validators/debate-chat-command.validator";

const DEFAULT_DEBATE_CHAT_WS_PORT = 8080;
const INVALID_CONNECTION_CLOSE_CODE = 1008;

@Injectable()
export class DebateChatWebSocketServer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DebateChatWebSocketServer.name);
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly communityRooms = new Map<string, Set<WebSocket>>();
  private readonly communitySocketMembers = new Map<WebSocket, string>();
  private server: WebSocketServer | null = null;
  private unsubscribeCommunityNotifications: (() => void) | null = null;
  private unsubscribeDebateIntentNotifications: (() => void) | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly debateChatService: DebateChatService,
    private readonly authService: AuthService,
    private readonly communityChatService: CommunityChatService,
    private readonly communityNotificationService: CommunityNotificationService,
  ) {}

  onApplicationBootstrap(): void {
    const port = this.configService.get<number>(
      "DEBATE_CHAT_WS_PORT",
      DEFAULT_DEBATE_CHAT_WS_PORT,
    );

    this.server = new WebSocketServer({ port });
    this.server.on("connection", (socket, request) => {
      void this.handleConnection(socket, request);
    });
    this.unsubscribeCommunityNotifications =
      this.communityNotificationService.subscribe((message) => {
        if (
          message.messageType === CommunityMessageType.DEBATE_RESULT &&
          message.debateId
        ) {
          this.publishDebateEnded(
            message.communityId,
            message.debateId,
            DebateStatus.COMPLETED,
            null,
          );
        }
        this.broadcastCommunity(
          message.communityId,
          createCommunityMessageEvent(message.communityId, message),
        );
      });
    this.unsubscribeDebateIntentNotifications =
      this.communityNotificationService.subscribeDebateIntent((notice) => {
        this.broadcastCommunity(notice.communityId, {
          id: randomUUID(),
          type: "community.member.debate-intent.changed",
          communityId: notice.communityId,
          member: notice.member,
        });
      });

    this.logger.log(`Debate chat WebSocket server listening on port ${port}.`);
  }

  onApplicationShutdown(): void {
    this.unsubscribeCommunityNotifications?.();
    this.unsubscribeCommunityNotifications = null;
    this.unsubscribeDebateIntentNotifications?.();
    this.unsubscribeDebateIntentNotifications = null;
    this.server?.close();
    this.server = null;
    this.rooms.clear();
    this.communityRooms.clear();
    this.communitySocketMembers.clear();
  }

  publishDebateStarted(communityId: string, payload: object): void {
    this.broadcastCommunity(communityId, {
      id: randomUUID(),
      type: "debate.started",
      communityId,
      ...payload,
    });
  }

  publishDebateRequested(
    communityId: string,
    opponentMemberId: string,
    payload: object,
  ): void {
    this.sendToCommunityMember(communityId, opponentMemberId, {
      id: randomUUID(),
      type: "debate.requested",
      communityId,
      ...payload,
    });
  }

  publishDebateRequestRejected(
    communityId: string,
    hostMemberId: string,
    payload: object,
  ): void {
    this.sendToCommunityMember(communityId, hostMemberId, {
      id: randomUUID(),
      type: "debate.request.rejected",
      communityId,
      ...payload,
    });
  }

  publishDebateRequestExpired(
    communityId: string,
    hostMemberId: string,
    opponentMemberId: string,
    payload: object,
  ): void {
    const event = {
      id: randomUUID(),
      type: "debate.request.expired",
      communityId,
      ...payload,
    };
    this.sendToCommunityMember(communityId, hostMemberId, event);
    this.sendToCommunityMember(communityId, opponentMemberId, event);
  }

  publishTurnFinalized(
    debateId: string,
    turn: import("./dto/debate-chat.dto").DebateChatTurnDto,
  ): void {
    this.broadcast(debateId, {
      id: randomUUID(),
      type: DEBATE_TURN_FINALIZED_EVENT,
      debateId,
      turn,
    });
  }

  publishDebateEnded(
    communityId: string,
    debateId: string,
    status: string,
    reason: string | null,
  ): void {
    const event: DebateChatServerEvent = {
      id: randomUUID(),
      type: "debate.ended",
      communityId,
      debateId,
      status,
      reason,
    };
    this.broadcast(debateId, event);
    this.broadcastCommunity(communityId, event);
  }

  private async handleConnection(
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    const debateId = parseDebateIdFromUrl(request.url);
    const communityId = parseCommunityIdFromUrl(request.url);
    const accessToken = extractBearerToken(request.headers.authorization);

    if ((!debateId && !communityId) || !accessToken) {
      socket.close(INVALID_CONNECTION_CLOSE_CODE, "Invalid chat path.");
      return;
    }

    const pendingMessages: RawData[] = [];
    const collectPendingMessage = (data: RawData) => {
      if (pendingMessages.length < 20) pendingMessages.push(data);
    };
    socket.on("message", collectPendingMessage);

    let memberId: string;
    try {
      memberId = (await this.authService.verifyAccessToken(accessToken))
        .memberId;
    } catch {
      socket.close(INVALID_CONNECTION_CLOSE_CODE, "Unauthorized.");
      return;
    }

    if (communityId) {
      await this.handleCommunityConnection(
        socket,
        communityId,
        memberId,
        pendingMessages,
        collectPendingMessage,
      );
      return;
    }

    if (!debateId) {
      socket.close(INVALID_CONNECTION_CLOSE_CODE, "Invalid debate chat path.");
      return;
    }

    this.addToRoom(debateId, socket);

    socket.off("message", collectPendingMessage);
    socket.on("message", (data) => {
      void this.handleMessage(debateId, memberId, socket, data);
    });
    socket.on("close", () => this.removeFromRoom(debateId, socket));

    for (const data of pendingMessages) {
      void this.handleMessage(debateId, memberId, socket, data);
    }

    try {
      const snapshot =
        await this.debateChatService.getConnectionSnapshot(debateId);
      sendEvent(socket, {
        id: randomUUID(),
        type: DEBATE_CONNECTION_RESTORED_EVENT,
        debateId,
        currentTurn: snapshot.currentTurn,
        turns: snapshot.turns,
        draftMessages: snapshot.draftMessages,
      });
    } catch (error) {
      sendEvent(socket, createErrorEvent(debateId, undefined, error));
    }
  }

  private async handleCommunityConnection(
    socket: WebSocket,
    communityId: string,
    memberId: string,
    pendingMessages: RawData[],
    collectPendingMessage: (data: RawData) => void,
  ): Promise<void> {
    try {
      await this.communityChatService.joinCommunity(communityId, memberId);
    } catch (error) {
      sendEvent(
        socket,
        createCommunityErrorEvent(communityId, undefined, error),
      );
      socket.close(INVALID_CONNECTION_CLOSE_CODE, "Community not found.");
      return;
    }

    this.addToCommunityRoom(communityId, memberId, socket);
    socket.off("message", collectPendingMessage);
    socket.on("message", (data) => {
      void this.handleCommunityMessage(communityId, memberId, socket, data);
    });
    socket.on("close", () => this.removeFromCommunityRoom(communityId, socket));

    for (const data of pendingMessages) {
      void this.handleCommunityMessage(communityId, memberId, socket, data);
    }

    try {
      const messages = await this.communityChatService.listMessages(
        communityId,
        50,
      );
      for (const message of messages) {
        sendEvent(socket, createCommunityMessageEvent(communityId, message));
      }
      const opinions =
        await this.communityChatService.listOpinions(communityId);
      for (const opinion of opinions) {
        sendEvent(socket, createCommunityOpinionEvent(communityId, opinion));
      }
    } catch (error) {
      sendEvent(
        socket,
        createCommunityErrorEvent(communityId, undefined, error),
      );
    }
  }

  private async handleCommunityMessage(
    communityId: string,
    memberId: string,
    socket: WebSocket,
    data: RawData,
  ): Promise<void> {
    let commandId: string | undefined;
    try {
      const raw: unknown = JSON.parse(rawDataToString(data));
      const command = validateCommunityCommand(raw);
      commandId = command.id;
      if (command.type === "opinion.submit") {
        const opinion = await this.communityChatService.saveOpinion(
          communityId,
          memberId,
          { claim: command.claim, reasons: command.reasons },
        );
        sendEvent(socket, {
          id: randomUUID(),
          type: COMMUNITY_OPINION_ACK_EVENT,
          communityId,
          commandId: command.id,
          status: COMMUNITY_COMMAND_STATUS_STORED,
          opinion,
        } satisfies CommunityOpinionAckEvent);
        this.broadcastExceptCommunity(
          communityId,
          socket,
          createCommunityOpinionEvent(communityId, opinion),
        );
        return;
      }
      const result = await this.communityChatService.sendMessage(
        communityId,
        memberId,
        {
          clientMessageId: command.clientMessageId,
          text: command.text,
        },
      );
      const event = createCommunityMessageEvent(communityId, result.message);
      sendEvent(socket, {
        id: randomUUID(),
        type: COMMUNITY_MESSAGE_ACK_EVENT,
        communityId,
        commandId: command.id,
        clientMessageId: command.clientMessageId,
        status: result.created
          ? COMMUNITY_COMMAND_STATUS_STORED
          : COMMUNITY_COMMAND_STATUS_DUPLICATE,
        message: result.message,
      } satisfies CommunityMessageAckEvent);
      if (result.created) {
        this.broadcastExceptCommunity(communityId, socket, event);
      }
    } catch (error) {
      sendEvent(
        socket,
        createCommunityErrorEvent(communityId, commandId, error),
      );
    }
  }

  private async handleMessage(
    debateId: string,
    memberId: string,
    socket: WebSocket,
    data: RawData,
  ): Promise<void> {
    let commandId: string | undefined;

    try {
      const command = parseDebateChatCommand(
        rawDataToString(data),
        this.configService.get<number>("DEBATE_TURN_MAX_CONTENT_LENGTH", 500),
      );
      commandId = command.id;

      if (command.payload.speakerId !== memberId) {
        throw new DebateChatInputError(
          "Authenticated member does not match payload.speakerId.",
        );
      }

      if (
        command.type === DEBATE_TURN_SEND_COMMAND ||
        command.type === DEBATE_TURN_MESSAGE_SEND_COMMAND
      ) {
        const result = await this.debateChatService.appendDraftMessage(
          debateId,
          command,
        );

        sendEvent(socket, {
          id: randomUUID(),
          type: DEBATE_TURN_MESSAGE_ACK_EVENT,
          debateId,
          commandId: command.id,
          ...(command.clientMessageId
            ? { clientMessageId: command.clientMessageId }
            : {}),
          status: result.status,
          message: result.message,
        });

        if (result.status !== DEBATE_TURN_MESSAGE_APPEND_STATUS_APPENDED) {
          return;
        }

        this.broadcastExcept(debateId, socket, {
          id: randomUUID(),
          type: DEBATE_TURN_MESSAGE_CREATED_EVENT,
          debateId,
          message: result.message,
        });
        return;
      }

      if (command.type === DEBATE_TURN_FINALIZE_COMMAND) {
        const turn = await this.debateChatService.finalizeTurn(
          debateId,
          command,
        );

        this.broadcast(debateId, {
          id: randomUUID(),
          type: DEBATE_TURN_FINALIZED_EVENT,
          debateId,
          turn,
        });
      }
    } catch (error) {
      sendEvent(socket, createErrorEvent(debateId, commandId, error));
    }
  }

  private broadcast(debateId: string, event: DebateChatServerEvent): void {
    const room = this.rooms.get(debateId);

    if (!room) {
      return;
    }

    for (const socket of room) {
      sendEvent(socket, event);
    }
  }

  private broadcastExcept(
    debateId: string,
    excludedSocket: WebSocket,
    event: DebateChatServerEvent,
  ): void {
    const room = this.rooms.get(debateId);

    if (!room) {
      return;
    }

    for (const socket of room) {
      if (socket === excludedSocket) {
        continue;
      }

      sendEvent(socket, event);
    }
  }

  private addToRoom(debateId: string, socket: WebSocket): void {
    const room = this.rooms.get(debateId) ?? new Set<WebSocket>();
    room.add(socket);
    this.rooms.set(debateId, room);
  }

  private removeFromRoom(debateId: string, socket: WebSocket): void {
    const room = this.rooms.get(debateId);

    if (!room) {
      return;
    }

    room.delete(socket);

    if (room.size === 0) {
      this.rooms.delete(debateId);
    }
  }

  private broadcastCommunity(communityId: string, event: object): void {
    const room = this.communityRooms.get(communityId);
    if (!room) return;
    for (const socket of room) {
      sendEvent(socket, event);
    }
  }

  private sendToCommunityMember(
    communityId: string,
    memberId: string,
    event: object,
  ): void {
    const room = this.communityRooms.get(communityId);
    if (!room) return;
    for (const socket of room) {
      if (this.communitySocketMembers.get(socket) === memberId) {
        sendEvent(socket, event);
      }
    }
  }

  private broadcastExceptCommunity(
    communityId: string,
    excludedSocket: WebSocket,
    event: object,
  ): void {
    const room = this.communityRooms.get(communityId);
    if (!room) return;
    for (const socket of room) {
      if (socket !== excludedSocket) sendEvent(socket, event);
    }
  }

  private addToCommunityRoom(
    communityId: string,
    memberId: string,
    socket: WebSocket,
  ): void {
    const room = this.communityRooms.get(communityId) ?? new Set<WebSocket>();
    room.add(socket);
    this.communityRooms.set(communityId, room);
    this.communitySocketMembers.set(socket, memberId);
  }

  private removeFromCommunityRoom(
    communityId: string,
    socket: WebSocket,
  ): void {
    const room = this.communityRooms.get(communityId);
    if (!room) return;
    room.delete(socket);
    this.communitySocketMembers.delete(socket);
    if (room.size === 0) this.communityRooms.delete(communityId);
  }
}

function parseDebateIdFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  const parsedUrl = new URL(url, "ws://localhost");
  const match = /^\/debates\/([^/]+)\/chat$/.exec(parsedUrl.pathname);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function parseCommunityIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const parsedUrl = new URL(url, "ws://localhost");
  const match = /^\/communities\/([^/]+)\/chat$/.exec(parsedUrl.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return data.toString("utf8");
}

function sendEvent(socket: WebSocket, event: object): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(event));
}

function createCommunityMessageEvent(
  communityId: string,
  message: CommunityMessageCreatedEvent["message"],
): CommunityMessageCreatedEvent {
  return {
    id: randomUUID(),
    type: "message.created",
    communityId,
    message,
  };
}

function createCommunityOpinionEvent(
  communityId: string,
  opinion: CommunityOpinionSubmittedEvent["opinion"],
): CommunityOpinionSubmittedEvent {
  return {
    id: randomUUID(),
    type: "opinion.submitted",
    communityId,
    opinion,
  };
}

function createCommunityErrorEvent(
  communityId: string,
  commandId: string | undefined,
  error: unknown,
): object {
  return {
    id: randomUUID(),
    type: "error",
    communityId,
    ...(commandId ? { commandId } : {}),
    message: error instanceof Error ? error.message : "Unexpected chat error.",
  };
}

function createErrorEvent(
  debateId: string | undefined,
  commandId: string | undefined,
  error: unknown,
): DebateChatErrorEvent {
  const isKnownError =
    error instanceof DebateChatInputError ||
    error instanceof DebateChatStateError;

  return {
    id: randomUUID(),
    type: DEBATE_CHAT_ERROR_EVENT,
    ...(debateId ? { debateId } : {}),
    ...(commandId ? { commandId } : {}),
    code: isKnownError ? error.name : "DebateChatUnexpectedError",
    message:
      error instanceof Error ? error.message : "Unexpected debate chat error.",
  };
}
