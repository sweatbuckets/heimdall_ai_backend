import { randomUUID } from "node:crypto";
import { IncomingMessage } from "node:http";
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RawData, WebSocket, WebSocketServer } from "ws";
import {
  DEBATE_CHAT_ERROR_EVENT,
  DEBATE_CONNECTION_RESTORED_EVENT,
  DEBATE_TURN_FINALIZE_COMMAND,
  DEBATE_TURN_FINALIZED_EVENT,
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
  private server: WebSocketServer | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly debateChatService: DebateChatService,
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

    this.logger.log(`Debate chat WebSocket server listening on port ${port}.`);
  }

  onApplicationShutdown(): void {
    this.server?.close();
    this.server = null;
    this.rooms.clear();
  }

  private async handleConnection(
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    const debateId = parseDebateIdFromUrl(request.url);

    if (!debateId) {
      socket.close(INVALID_CONNECTION_CLOSE_CODE, "Invalid debate chat path.");
      return;
    }

    this.addToRoom(debateId, socket);

    socket.on("message", (data) => {
      void this.handleMessage(debateId, socket, data);
    });
    socket.on("close", () => this.removeFromRoom(debateId, socket));

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

  private async handleMessage(
    debateId: string,
    socket: WebSocket,
    data: RawData,
  ): Promise<void> {
    let commandId: string | undefined;

    try {
      const command = parseDebateChatCommand(rawDataToString(data));
      commandId = command.id;

      if (
        command.type === DEBATE_TURN_SEND_COMMAND ||
        command.type === DEBATE_TURN_MESSAGE_SEND_COMMAND
      ) {
        const message = await this.debateChatService.appendDraftMessage(
          debateId,
          command,
        );

        this.broadcast(debateId, {
          id: randomUUID(),
          type: DEBATE_TURN_MESSAGE_CREATED_EVENT,
          debateId,
          message,
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
}

function parseDebateIdFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  const parsedUrl = new URL(url, "ws://localhost");
  const match = /^\/debates\/([^/]+)\/chat$/.exec(parsedUrl.pathname);

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

function sendEvent(socket: WebSocket, event: DebateChatServerEvent): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(event));
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
