import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import {
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchTaskStatus,
} from "../debates/domain/debate.enums";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { DebateEntity } from "../debates/entities/debate.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";
import { JudgeService } from "./judge.service";
import { DEFAULT_JUDGE_PROCESSING_STALE_MS } from "./constants";

@Injectable()
export class JudgeReadinessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly judgeService: JudgeService,
    private readonly configService: ConfigService,
  ) {}

  async tryStartJudge(debateId: string): Promise<void> {
    const debate = await this.dataSource
      .getRepository(DebateEntity)
      .findOne({ where: { id: debateId } });

    if (!debate || debate.status !== DebateStatus.DEBATE_FINALIZED) {
      return;
    }

    const [
      turnCount,
      incompleteTurnCount,
      incompleteFactCheckTaskCount,
      missingFactCheckResultCount,
      judgmentResultCount,
    ] = await Promise.all([
      this.dataSource
        .getRepository(DebateTurnEntity)
        .count({ where: { debateId } }),
      this.countIncompleteTurns(debateId),
      this.countIncompleteFactCheckTasks(debateId),
      this.countMissingFactCheckResults(debateId),
      this.dataSource
        .getRepository(JudgmentResultEntity)
        .count({ where: { debateId } }),
    ]);

    const expectedTurnCount = 4 + debate.rebuttalQuestionRounds * 2;

    if (
      turnCount !== expectedTurnCount ||
      incompleteTurnCount > 0 ||
      incompleteFactCheckTaskCount > 0 ||
      missingFactCheckResultCount > 0 ||
      judgmentResultCount > 0
    ) {
      return;
    }

    const claimResult = await this.dataSource
      .createQueryBuilder()
      .update(DebateEntity)
      .set({
        status: DebateStatus.JUDGING,
        judgingStartedAt: new Date(),
      })
      .where("id = :debateId", { debateId })
      .andWhere("status = :status", {
        status: DebateStatus.DEBATE_FINALIZED,
      })
      .execute();

    if (claimResult.affected !== 1) {
      return;
    }

    await this.executeClaimedJudge(debateId);
  }

  async retryStaleJudge(debateId: string): Promise<void> {
    const hasJudgmentResult =
      (await this.dataSource
        .getRepository(JudgmentResultEntity)
        .count({ where: { debateId } })) > 0;

    if (hasJudgmentResult) {
      return;
    }

    const staleMs = this.configService.get<number>(
      "JUDGE_PROCESSING_STALE_MS",
      DEFAULT_JUDGE_PROCESSING_STALE_MS,
    );
    const staleBefore = new Date(Date.now() - staleMs);

    const claimResult = await this.dataSource
      .createQueryBuilder()
      .update(DebateEntity)
      .set({ judgingStartedAt: new Date() })
      .where("id = :debateId", { debateId })
      .andWhere("status = :status", { status: DebateStatus.JUDGING })
      .andWhere(
        "(judging_started_at IS NULL OR judging_started_at < :staleBefore)",
        { staleBefore },
      )
      .execute();

    if (claimResult.affected !== 1) {
      return;
    }

    await this.executeClaimedJudge(debateId);
  }

  private countIncompleteTurns(debateId: string): Promise<number> {
    return this.dataSource
      .getRepository(DebateTurnEntity)
      .createQueryBuilder("turn")
      .where("turn.debate_id = :debateId", { debateId })
      .andWhere("turn.analysis_status <> :status", {
        status: DebateTurnAnalysisStatus.COMPLETED,
      })
      .getCount();
  }

  private countIncompleteFactCheckTasks(debateId: string): Promise<number> {
    return this.dataSource
      .getRepository(FactCheckBatchTaskEntity)
      .createQueryBuilder("task")
      .innerJoin("task.turn", "turn")
      .where("turn.debate_id = :debateId", { debateId })
      .andWhere("task.status <> :status", {
        status: FactCheckBatchTaskStatus.COMPLETED,
      })
      .getCount();
  }

  private countMissingFactCheckResults(debateId: string): Promise<number> {
    return this.dataSource
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

  private async executeClaimedJudge(debateId: string): Promise<void> {
    await this.judgeService.judgeDebate(debateId);
  }
}
