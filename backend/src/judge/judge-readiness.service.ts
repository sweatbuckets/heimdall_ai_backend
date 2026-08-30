import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager } from "typeorm";
import {
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchStatus,
  JudgeTaskStatus,
} from "../debates/domain/debate.enums";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { DebateEntity } from "../debates/entities/debate.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { FactCheckBatchEntity } from "../debates/entities/fact-check-batch.entity";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";
import { JudgeTaskEntity } from "../debates/entities/judge-task.entity";
import { DEFAULT_JUDGE_MANUAL_RETRY_STALE_MS } from "./constants";
import { JudgeConflictError } from "./errors/judge.errors";
import { JudgeQueueService } from "./judge-queue.service";

@Injectable()
export class JudgeReadinessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly queueService: JudgeQueueService,
    private readonly configService: ConfigService,
  ) {}

  async tryStartJudge(debateId: string): Promise<void> {
    const taskId = await this.dataSource.transaction(async (manager) => {
      const debate = await manager.findOne(DebateEntity, {
        where: { id: debateId },
        lock: { mode: "pessimistic_write" },
      });
      if (!debate || debate.status !== DebateStatus.DEBATE_FINALIZED) {
        return null;
      }

      const existingTask = await manager.findOne(JudgeTaskEntity, {
        where: { debateId },
      });
      if (existingTask) {
        return existingTask.status === JudgeTaskStatus.PENDING
          ? existingTask.id
          : null;
      }

      // All reads use the same transaction-bound QueryRunner. Keep them
      // sequential so pg is never asked to execute overlapping queries on
      // the same client connection.
      const turnCount = await manager.count(DebateTurnEntity, {
        where: { debateId },
      });
      const incompleteTurns = await this.countIncompleteTurns(
        manager,
        debateId,
      );
      const incompleteBatches = await this.countIncompleteFactCheckBatches(
        manager,
        debateId,
      );
      const missingResults = await this.countMissingFactCheckResults(
        manager,
        debateId,
      );
      const judgments = await manager.count(JudgmentResultEntity, {
        where: { debateId },
      });
      const expectedTurnCount = 4 + debate.rebuttalQuestionRounds * 2;
      if (
        turnCount !== expectedTurnCount ||
        incompleteTurns > 0 ||
        incompleteBatches > 0 ||
        missingResults > 0 ||
        judgments > 0
      ) {
        return null;
      }

      const taskId = randomUUID();
      await manager.insert(JudgeTaskEntity, {
        id: taskId,
        debateId,
        status: JudgeTaskStatus.PENDING,
        attemptCount: 0,
      });
      const updated = await manager.update(
        DebateEntity,
        { id: debateId, status: DebateStatus.DEBATE_FINALIZED },
        { status: DebateStatus.JUDGING, judgingStartedAt: new Date() },
      );
      if (updated.affected !== 1) {
        throw new JudgeConflictError(
          `Debate Judge readiness state changed: ${debateId}.`,
        );
      }
      return taskId;
    });

    if (taskId) {
      await this.queueService.enqueueTask(taskId);
    }
  }

  async retryStaleJudge(debateId: string): Promise<void> {
    const hasJudgmentResult =
      (await this.dataSource
        .getRepository(JudgmentResultEntity)
        .count({ where: { debateId } })) > 0;
    if (hasJudgmentResult) return;

    const staleMs = this.configService.get<number>(
      "JUDGE_MANUAL_RETRY_STALE_MS",
      DEFAULT_JUDGE_MANUAL_RETRY_STALE_MS,
    );
    await this.queueService.retryTaskForDebate(
      debateId,
      new Date(Date.now() - staleMs),
    );
  }

  private countIncompleteTurns(
    manager: EntityManager,
    debateId: string,
  ): Promise<number> {
    return manager
      .getRepository(DebateTurnEntity)
      .createQueryBuilder("turn")
      .where("turn.debate_id = :debateId", { debateId })
      .andWhere("turn.analysis_status <> :status", {
        status: DebateTurnAnalysisStatus.COMPLETED,
      })
      .getCount();
  }

  private countIncompleteFactCheckBatches(
    manager: EntityManager,
    debateId: string,
  ): Promise<number> {
    return manager
      .getRepository(FactCheckBatchEntity)
      .createQueryBuilder("batch")
      .where("batch.debate_id = :debateId", { debateId })
      .andWhere("batch.status <> :status", {
        status: FactCheckBatchStatus.COMPLETED,
      })
      .getCount();
  }

  private countMissingFactCheckResults(
    manager: EntityManager,
    debateId: string,
  ): Promise<number> {
    return manager
      .getRepository(ArgumentComponentEntity)
      .createQueryBuilder("component")
      .innerJoin("component.turn", "turn")
      .leftJoin("component.factCheckResults", "factCheckResult")
      .where("turn.debate_id = :debateId", { debateId })
      .andWhere("component.requires_fact_check = :requiresFactCheck", {
        requiresFactCheck: true,
      })
      .andWhere("factCheckResult.id IS NULL")
      .getCount();
  }
}
