import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DataSource, LessThanOrEqual } from "typeorm";
import { DebateStatus } from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { DebateChatService } from "./debate-chat.service";
import { DebateChatWebSocketServer } from "./debate-chat.websocket-server";
import { OPENING_TURN_LIMIT_SECONDS } from "./debate-turn-time-limit";

const TURN_TIMEOUT_POLL_INTERVAL_MS = 1_000;
const TURN_TIMEOUT_BATCH_SIZE = 20;

@Injectable()
export class DebateTurnTimeoutScheduler {
  private readonly logger = new Logger(DebateTurnTimeoutScheduler.name);
  private polling = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly debateChatService: DebateChatService,
    private readonly websocketServer: DebateChatWebSocketServer,
  ) {}

  @Interval(TURN_TIMEOUT_POLL_INTERVAL_MS)
  async finalizeExpiredTurns(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const earliestDeadline = new Date(
        Date.now() - OPENING_TURN_LIMIT_SECONDS * 1000,
      );
      const debates = await this.dataSource.getRepository(DebateEntity).find({
        where: {
          status: DebateStatus.IN_PROGRESS,
          currentTurnStartedAt: LessThanOrEqual(earliestDeadline),
        },
        order: { currentTurnStartedAt: "ASC" },
        take: TURN_TIMEOUT_BATCH_SIZE,
      });

      for (const debate of debates) {
        try {
          const turn = await this.debateChatService.finalizeExpiredTurn(
            debate.id,
          );
          if (turn) {
            this.websocketServer.publishTurnFinalized(debate.id, turn);
          }
        } catch (error) {
          this.logger.error(
            `Failed to auto-finalize debate turn. debateId=${debate.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
