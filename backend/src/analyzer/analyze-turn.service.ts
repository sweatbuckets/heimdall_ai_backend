import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { DataSource } from "typeorm";
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
  AnalyzeTurnInputError,
} from "./errors/analyzer.errors";
import { ArgumentComponentEntity } from "../debates/entities/argument-component.entity";
import { ArgumentalRelationEntity } from "../debates/entities/argumental-relation.entity";
import { DebateTurnEntity } from "../debates/entities/debate-turn.entity";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";
import { FactCheckBatchTargetEntity } from "../debates/entities/fact-check-batch-target.entity";
import {
  DebateStatus,
  DebateTurnAnalysisStatus,
  FactCheckBatchTaskStatus,
} from "../debates/domain/debate.enums";
import { InteractionalRelationEntity } from "../debates/entities/interactional-relation.entity";
import {
  FACT_CHECK_BATCH_JOB,
  FACT_CHECK_QUEUE,
  FactCheckJobData,
} from "../fact-check/queues/fact-check.constants";
import { AnalyzeTurnJobData } from "./queues/analyzer-job.data";
import { JudgeReadinessService } from "../judge/judge-readiness.service";
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
  factCheckBatchTaskId: string | null;
  skipped: boolean;
}

@Injectable()
export class AnalyzeTurnService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly analyzerInputAssembler: AnalyzerInputAssembler,
    private readonly analyzerAiService: AnalyzerAiService,
    private readonly configService: ConfigService,
    @InjectQueue(FACT_CHECK_QUEUE)
    private readonly factCheckQueue: Queue<FactCheckJobData>,
    private readonly judgeReadinessService: JudgeReadinessService,
    private readonly aiCancellationService: AiInvocationCancellationService,
  ) {}

  async analyzeTurn(
    turnId: string,
    job?: Job<AnalyzeTurnJobData>,
  ): Promise<AnalyzeTurnResult> {
    const claimed = await this.claimTurnForAnalysis(turnId);

    if (!claimed) {
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
      let factCheckBatchTaskId: string | null = null;

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

        if (mapping.factCheckTargetComponentIds.length > 0) {
          factCheckBatchTaskId = randomUUID();

          await manager.insert(FactCheckBatchTaskEntity, {
            id: factCheckBatchTaskId,
            turnId,
            status: FactCheckBatchTaskStatus.PENDING,
          });

          await manager.insert(
            FactCheckBatchTargetEntity,
            mapFactCheckTargets(
              factCheckBatchTaskId,
              mapping.factCheckTargetComponentIds,
            ),
          );
        }

        const completeResult = await manager
          .createQueryBuilder()
          .update(DebateTurnEntity)
          .set({
            analysisStatus: DebateTurnAnalysisStatus.COMPLETED,
            analysisProcessingStartedAt: null,
          })
          .where("id = :turnId", { turnId })
          .andWhere("analysis_status = :status", {
            status: DebateTurnAnalysisStatus.PROCESSING,
          })
          .execute();

        if (completeResult.affected !== 1) {
          throw new AnalyzeTurnConflictError(
            `DebateTurn analysis completion state changed: ${turnId}.`,
          );
        }
      });

      if (factCheckBatchTaskId && this.isFactCheckEnabled()) {
        await this.enqueueFactCheckBatch(factCheckBatchTaskId);
      }

      await this.judgeReadinessService.tryStartJudge(input.debate.id);

      return {
        turnId,
        componentCount: mapping.components.length,
        argumentalRelationCount: mapping.argumentalRelations.length,
        interactionalRelationCount: mapping.interactionalRelations.length,
        factCheckBatchTaskId,
        skipped: false,
      };
    } catch (error) {
      await this.releaseOrFailTurnAnalysis(turnId, job);
      if (error instanceof AiInvocationCancelledError) {
        return {
          turnId,
          componentCount: 0,
          argumentalRelationCount: 0,
          interactionalRelationCount: 0,
          factCheckBatchTaskId: null,
          skipped: true,
        };
      }
      throw error;
    }
  }

  private async claimTurnForAnalysis(turnId: string): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(DebateTurnEntity)
      .set({
        analysisStatus: DebateTurnAnalysisStatus.PROCESSING,
        analysisProcessingStartedAt: new Date(),
      })
      .where("id = :turnId", { turnId })
      .andWhere("analysis_status = :status", {
        status: DebateTurnAnalysisStatus.PENDING,
      })
      .execute();

    return result.affected === 1;
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
    const taskRepository = this.dataSource.getRepository(
      FactCheckBatchTaskEntity,
    );

    const [componentCount, factCheckBatchTask] = await Promise.all([
      componentRepository.count({
        where: { turnId },
      }),
      taskRepository.findOne({
        where: { turnId },
      }),
    ]);

    if (
      factCheckBatchTask?.status === FactCheckBatchTaskStatus.PENDING &&
      factCheckBatchTask.id &&
      this.isFactCheckEnabled()
    ) {
      await this.enqueueFactCheckBatch(factCheckBatchTask.id);
    }

    const turn = await this.dataSource.getRepository(DebateTurnEntity).findOne({
      where: { id: turnId },
      select: { debateId: true },
    });

    if (turn) {
      await this.judgeReadinessService.tryStartJudge(turn.debateId);
    }

    return {
      turnId,
      componentCount,
      argumentalRelationCount: 0,
      interactionalRelationCount: 0,
      factCheckBatchTaskId: factCheckBatchTask?.id ?? null,
      skipped: true,
    };
  }

  private async releaseOrFailTurnAnalysis(
    turnId: string,
    job: Job<AnalyzeTurnJobData> | undefined,
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
      .where("id = :turnId", { turnId })
      .andWhere("analysis_status = :status", {
        status: DebateTurnAnalysisStatus.PROCESSING,
      })
      .execute();
  }

  private isFinalAttempt(job: Job<AnalyzeTurnJobData> | undefined): boolean {
    if (!job) {
      return true;
    }

    const attempts =
      typeof job.opts.attempts === "number" ? job.opts.attempts : 1;

    return job.attemptsMade + 1 >= attempts;
  }

  private async enqueueFactCheckBatch(
    factCheckBatchTaskId: string,
  ): Promise<void> {
    const job = await this.factCheckQueue.add(
      FACT_CHECK_BATCH_JOB,
      { factCheckBatchTaskId },
      {
        jobId: factCheckBatchTaskId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    );

    await this.dataSource
      .createQueryBuilder()
      .update(FactCheckBatchTaskEntity)
      .set({
        bullMqJobId: String(job.id),
      })
      .where("id = :taskId", { taskId: factCheckBatchTaskId })
      .andWhere("status = :status", {
        status: FactCheckBatchTaskStatus.PENDING,
      })
      .execute();
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
