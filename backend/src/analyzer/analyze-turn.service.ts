import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { DataSource, LessThan } from "typeorm";
import { AnalyzerAiService } from "./analyzer-ai.service";
import { AnalyzerInputAssembler } from "./analyzer-input.assembler";
import {
  AnalyzeTurnValidationLimits,
  validateAnalyzeTurnOutput,
} from "./validators/analyze-turn-output.validator";
import {
  mapAnalyzeTurnOutputToEntities,
  mapFactCheckTargets,
} from "./mappers/analyze-turn-entity.mapper";
import {
  AnalyzeTurnConflictError,
  AnalyzeTurnDependencyPendingError,
  AnalyzeTurnInputError,
} from "./errors/analyzer.errors";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { ArgumentalRelationEntity } from "../debates/entities/argumental-relation.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { FactCheckBatchEntity } from "../debates/entities/fact-check-batch.entity";
import { FactCheckBatchTargetEntity } from "../debates/entities/fact-check-batch-target.entity";
import { FactCheckStageTaskEntity } from "../debates/entities/fact-check-stage-task.entity";
import {
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchStatus,
  FactCheckStage,
  FactCheckStageTaskStatus,
} from "../debates/domain/debate.enums";
import { InteractionalRelationEntity } from "../debates/entities/interactional-relation.entity";
import { FactCheckQueueService } from "../fact-check/fact-check-queue.service";
import { AnalyzeRoundJobData } from "./queues/analyzer-job.data";
import {
  AiInvocationCancellationService,
  AiInvocationCancelledError,
} from "../ai/ai-invocation-cancellation.service";
import { DebateEntity } from "../debates/entities/debate.entity";

export interface AnalyzeTurnResult {
  turnId: string;
  componentCount: number;
  argumentalRelationCount: number;
  interactionalRelationCount: number;
  factCheckBatchId: string | null;
  skipped: boolean;
}

@Injectable()
export class AnalyzeTurnService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly analyzerInputAssembler: AnalyzerInputAssembler,
    private readonly analyzerAiService: AnalyzerAiService,
    private readonly configService: ConfigService,
    private readonly factCheckQueueService: FactCheckQueueService,
    private readonly aiCancellationService: AiInvocationCancellationService,
  ) {}

  async analyzeTurn(
    turnId: string,
    job?: Job<AnalyzeRoundJobData>,
  ): Promise<AnalyzeTurnResult> {
    const claimedTurnIds = await this.claimRoundForAnalysis(turnId);

    if (!claimedTurnIds) {
      return this.handleUnclaimedTurn(turnId);
    }

    try {
      const input = await this.analyzerInputAssembler.assemble(turnId);
      const output = await this.aiCancellationService.run(
        input.debate.id,
        (signal) => this.analyzerAiService.analyze(input, signal),
      );
      const limits = this.getValidationLimits();
      validateAnalyzeTurnOutput(input, output, limits);

      const mapping = mapAnalyzeTurnOutputToEntities(input, output);
      let factCheckBatchId: string | null = null;
      let groundingTaskId: string | null = null;

      await this.dataSource.transaction(async (manager) => {
        const debate = await manager.findOne(DebateEntity, {
          where: { id: input.debate.id },
          lock: { mode: "pessimistic_read" },
        });
        if (!debate || debate.status === DebateStatus.FAILED) {
          throw new AiInvocationCancelledError(input.debate.id);
        }

        if (mapping.components.length > 0) {
          await manager.insert(ArgumentComponentEntity, mapping.components);
        }

        if (mapping.argumentalRelations.length > 0) {
          await manager.insert(
            ArgumentalRelationEntity,
            mapping.argumentalRelations,
          );
        }

        if (mapping.interactionalRelations.length > 0) {
          await manager.insert(
            InteractionalRelationEntity,
            mapping.interactionalRelations,
          );
        }

        const targetComponentIds = output.newComponents
          .filter((component) => component.requiresFactCheck)
          .map((component) => {
            const componentId = mapping.localKeyToComponentId.get(
              component.localKey,
            );
            if (!componentId) {
              throw new AnalyzeTurnConflictError(
                `Fact-check target component mapping is missing: ${component.localKey}.`,
              );
            }
            return componentId;
          });

        if (targetComponentIds.length > 0) {
          const firstTurn = input.currentTurns[0];
          factCheckBatchId = randomUUID();
          groundingTaskId = randomUUID();
          await manager.insert(FactCheckBatchEntity, {
            id: factCheckBatchId,
            debateId: input.debate.id,
            phase: firstTurn.phase,
            round: firstTurn.round,
            status: FactCheckBatchStatus.PENDING,
          });
          await manager.insert(
            FactCheckBatchTargetEntity,
            mapFactCheckTargets(factCheckBatchId, targetComponentIds),
          );
          await manager.insert(FactCheckStageTaskEntity, {
            id: groundingTaskId,
            factCheckBatchId,
            stage: FactCheckStage.GROUNDING,
            status: FactCheckStageTaskStatus.PENDING,
            attemptCount: 0,
          });
        }

        const completeResult = await manager
          .createQueryBuilder()
          .update(DebateTurnEntity)
          .set({
            analysisStatus: DebateTurnAnalysisStatus.COMPLETED,
            analysisProcessingStartedAt: null,
          })
          .where("id IN (:...turnIds)", { turnIds: claimedTurnIds })
          .andWhere("analysis_status = :status", {
            status: DebateTurnAnalysisStatus.PROCESSING,
          })
          .execute();

        if (completeResult.affected !== claimedTurnIds.length) {
          throw new AnalyzeTurnConflictError(
            `Debate round analysis completion state changed: ${claimedTurnIds.join(",")}.`,
          );
        }
      });

      if (this.isFactCheckEnabled() && groundingTaskId) {
        await this.factCheckQueueService.enqueueGroundingTask(groundingTaskId);
      }

      return {
        turnId,
        componentCount: mapping.components.length,
        argumentalRelationCount: mapping.argumentalRelations.length,
        interactionalRelationCount: mapping.interactionalRelations.length,
        factCheckBatchId,
        skipped: false,
      };
    } catch (error) {
      await this.releaseOrFailRoundAnalysis(claimedTurnIds, job);
      if (error instanceof AiInvocationCancelledError) {
        return {
          turnId,
          componentCount: 0,
          argumentalRelationCount: 0,
          interactionalRelationCount: 0,
          factCheckBatchId: null,
          skipped: true,
        };
      }
      throw error;
    }
  }

  private async claimRoundForAnalysis(
    turnId: string,
  ): Promise<string[] | null> {
    const turnRepository = this.dataSource.getRepository(DebateTurnEntity);
    const requestedTurn = await turnRepository.findOne({
      where: { id: turnId },
    });

    if (!requestedTurn) {
      throw new AnalyzeTurnInputError(`DebateTurn not found: ${turnId}.`);
    }

    const roundTurns = await turnRepository.find({
      where: {
        debateId: requestedTurn.debateId,
        phase: requestedTurn.phase,
        round: requestedTurn.round,
      },
      order: { sequence: "ASC" },
    });

    if (roundTurns.length !== 2) {
      return null;
    }

    const turnIds = roundTurns.map((turn) => turn.id);
    const firstSequence = roundTurns[0].sequence;
    const result = await this.dataSource
      .createQueryBuilder()
      .update(DebateTurnEntity)
      .set({
        analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
        analysisProcessingStartedAt: new Date(),
      })
      .where("id IN (:...turnIds)", { turnIds })
      .andWhere("analysis_status = :status", {
        status: DebateTurnAnalysisStatus.PENDING,
      })
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM "debate_turn" "round_turn"
          WHERE "round_turn"."id" IN (:...turnIds)
            AND "round_turn"."analysis_status" <> :pendingStatus
        )`,
        { pendingStatus: DebateTurnAnalysisStatus.PENDING },
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM "debate_turn" "previous_turn"
          WHERE "previous_turn"."debate_id" = :debateId
            AND "previous_turn"."sequence" < :firstSequence
            AND "previous_turn"."analysis_status" <> :completedStatus
        )`,
        {
          debateId: requestedTurn.debateId,
          firstSequence,
          completedStatus: DebateTurnAnalysisStatus.COMPLETED,
        },
      )
      .execute();

    return result.affected === turnIds.length ? turnIds : null;
  }

  private async handleUnclaimedTurn(
    turnId: string,
  ): Promise<AnalyzeTurnResult> {
    const turn = await this.dataSource.getRepository(DebateTurnEntity).findOne({
      where: { id: turnId },
    });

    if (!turn) {
      throw new AnalyzeTurnInputError(`DebateTurn not found: ${turnId}.`);
    }

    if (turn.analysisStatus === DebateTurnAnalysisStatus.COMPLETED) {
      return this.getCompletedAnalysisResult(turnId);
    }

    const failedPredecessorCount = await this.dataSource
      .getRepository(DebateTurnEntity)
      .count({
        where: {
          debateId: turn.debateId,
          sequence: LessThan(turn.sequence),
          analysisStatus: DebateTurnAnalysisStatus.FAILED,
        },
      });

    if (failedPredecessorCount > 0) {
      throw new AnalyzeTurnConflictError(
        `Debate round cannot be analyzed because an earlier round failed: ${turnId}.`,
      );
    }

    if (
      turn.analysisStatus === DebateTurnAnalysisStatus.PENDING ||
      turn.analysisStatus === DebateTurnAnalysisStatus.PROCESSING
    ) {
      throw new AnalyzeTurnDependencyPendingError(turnId);
    }

    throw new AnalyzeTurnConflictError(
      `DebateTurn cannot be claimed for analysis: ${turnId} (${turn.analysisStatus}).`,
    );
  }

  private async getCompletedAnalysisResult(
    turnId: string,
  ): Promise<AnalyzeTurnResult> {
    const componentRepository = this.dataSource.getRepository(
      ArgumentComponentEntity,
    );
    const turn = await this.dataSource.getRepository(DebateTurnEntity).findOne({
      where: { id: turnId },
    });
    const componentCount = await componentRepository.count({
      where: { turnId },
    });
    const factCheckBatch = turn
      ? await this.dataSource.getRepository(FactCheckBatchEntity).findOne({
          where: {
            debateId: turn.debateId,
            phase: turn.phase,
            round: turn.round,
          },
        })
      : null;
    if (
      factCheckBatch?.status === FactCheckBatchStatus.PENDING &&
      this.isFactCheckEnabled()
    ) {
      const groundingTask = await this.dataSource
        .getRepository(FactCheckStageTaskEntity)
        .findOne({
          where: {
            factCheckBatchId: factCheckBatch.id,
            stage: FactCheckStage.GROUNDING,
            status: FactCheckStageTaskStatus.PENDING,
          },
        });
      if (groundingTask) {
        await this.factCheckQueueService.enqueueGroundingTask(groundingTask.id);
      }
    }

    return {
      turnId,
      componentCount,
      argumentalRelationCount: 0,
      interactionalRelationCount: 0,
      factCheckBatchId: factCheckBatch?.id ?? null,
      skipped: true,
    };
  }

  private async releaseOrFailRoundAnalysis(
    turnIds: string[],
    job: Job<AnalyzeRoundJobData> | undefined,
  ): Promise<void> {
    const nextStatus = this.isFinalAttempt(job)
      ? DebateTurnAnalysisStatus.FAILED
      : DebateTurnAnalysisStatus.PENDING;

    await this.dataSource
      .createQueryBuilder()
      .update(DebateTurnEntity)
      .set({
        analysisStatus: nextStatus,
        analysisProcessingStartedAt: null,
      })
      .where("id IN (:...turnIds)", { turnIds })
      .andWhere("analysis_status = :status", {
        status: DebateTurnAnalysisStatus.PROCESSING,
      })
      .execute();
  }

  private isFinalAttempt(job: Job<AnalyzeRoundJobData> | undefined): boolean {
    if (!job) {
      return true;
    }

    const attempts =
      typeof job.opts.attempts === "number" ? job.opts.attempts : 1;

    return job.attemptsMade + 1 >= attempts;
  }

  private getValidationLimits(): AnalyzeTurnValidationLimits {
    return {
      maxComponentsPerTurn: this.configService.get<number>(
        "ANALYZER_MAX_COMPONENTS_PER_TURN",
        10,
      ),
      maxFactCheckTargetsPerTurn: this.configService.get<number>(
        "ANALYZER_MAX_FACT_CHECK_TARGETS_PER_TURN",
        5,
      ),
      maxComponentStatementLength: this.configService.get<number>(
        "ANALYZER_MAX_COMPONENT_STATEMENT_LENGTH",
        1000,
      ),
    };
  }

  private isFactCheckEnabled(): boolean {
    return this.configService.get<boolean>("FACT_CHECK_ENABLED", true);
  }
}
