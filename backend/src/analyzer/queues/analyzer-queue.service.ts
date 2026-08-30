import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { DataSource, LessThan, MoreThan, Not } from "typeorm";
import {
  ANALYZER_QUEUE,
  ANALYZE_ROUND_JOB,
  ANALYZE_ROUND_JOB_ATTEMPTS,
  ANALYZE_ROUND_JOB_BACKOFF_DELAY_MS,
  ANALYZE_ROUND_JOB_BACKOFF_JITTER,
} from "../constants";
import { AnalyzeRoundJobData } from "./analyzer-job.data";
import { DebateTurnEntity } from "../../debates/entities/debate-turn.entity";
import { DebateTurnAnalysisStatus } from "../../debates/domain/debate.enums";

@Injectable()
export class AnalyzerQueueService {
  private readonly logger = new Logger(AnalyzerQueueService.name);

  constructor(
    @InjectQueue(ANALYZER_QUEUE)
    private readonly analyzerQueue: Queue<AnalyzeRoundJobData>,
    private readonly dataSource: DataSource,
  ) {}

  async enqueueAnalyzeTurn(turnId: string): Promise<string | null> {
    const round = await this.findCompleteRound(turnId);
    if (!round) {
      this.logger.log(`Analyzer round is not ready. turnId=${turnId}`);
      return null;
    }
    return this.enqueue(round);
  }

  async enqueueRecoveredAnalyzeTurn(turnId: string): Promise<string | null> {
    const round = await this.findCompleteRound(turnId);
    if (!round) return null;
    const job = await this.ensureJob(round);
    return String(job.id);
  }

  async enqueuePendingAnalyzeTurn(turnId: string): Promise<string | null> {
    const round = await this.findCompleteRound(turnId);
    if (!round) return null;
    const job = await this.ensureJob(round);
    return String(job.id);
  }

  async enqueueNextReadyRound(turnId: string): Promise<string | null> {
    const repository = this.dataSource.getRepository(DebateTurnEntity);
    const currentTurn = await repository.findOne({ where: { id: turnId } });
    if (!currentTurn) return null;

    const nextPendingTurn = await repository.findOne({
      where: {
        debateId: currentTurn.debateId,
        sequence: MoreThan(currentTurn.sequence),
        analysisStatus: DebateTurnAnalysisStatus.PENDING,
      },
      order: { sequence: "ASC" },
    });
    if (!nextPendingTurn) return null;
    return this.enqueueAnalyzeTurn(nextPendingTurn.id);
  }

  async cancelAnalyzeTurn(turnId: string): Promise<void> {
    const turn = await this.dataSource
      .getRepository(DebateTurnEntity)
      .findOne({ where: { id: turnId } });
    if (!turn) return;
    const job = await this.analyzerQueue.getJob(
      this.buildJobId({
        anchorTurnId: turn.id,
        debateId: turn.debateId,
        phase: turn.phase,
        round: turn.round,
      }),
    );
    if (!job) return;
    const state = await job.getState();
    if (state !== "active" && state !== "completed") {
      await job.remove();
    }
  }

  private async enqueue(round: AnalyzeRoundJobData): Promise<string> {
    const job = await this.analyzerQueue.add(ANALYZE_ROUND_JOB, round, {
      jobId: this.buildJobId(round),
      attempts: ANALYZE_ROUND_JOB_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: ANALYZE_ROUND_JOB_BACKOFF_DELAY_MS,
        jitter: ANALYZE_ROUND_JOB_BACKOFF_JITTER,
      },
    });

    this.logger.log(
      `Analyzer round job queued. jobId=${String(job.id)} debateId=${round.debateId} phase=${round.phase} round=${round.round}`,
    );

    return String(job.id);
  }

  private async ensureJob(
    round: AnalyzeRoundJobData,
  ): Promise<Job<AnalyzeRoundJobData>> {
    const jobId = this.buildJobId(round);
    const existingJob = await this.analyzerQueue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();

      if (state === "failed") {
        await existingJob.retry();
        this.logger.log(
          `Analyzer failed round job requeued. jobId=${String(existingJob.id)} debateId=${round.debateId} phase=${round.phase} round=${round.round}`,
        );
        return existingJob;
      }

      if (state !== "completed") {
        this.logger.log(
          `Analyzer round job already queued. jobId=${String(existingJob.id)} debateId=${round.debateId} phase=${round.phase} round=${round.round} state=${state}`,
        );
        return existingJob;
      }

      await existingJob.remove();
    }

    const job = await this.analyzerQueue.add(ANALYZE_ROUND_JOB, round, {
      jobId,
      attempts: ANALYZE_ROUND_JOB_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: ANALYZE_ROUND_JOB_BACKOFF_DELAY_MS,
        jitter: ANALYZE_ROUND_JOB_BACKOFF_JITTER,
      },
    });
    this.logger.log(
      `Analyzer recovery round job queued. jobId=${String(job.id)} debateId=${round.debateId} phase=${round.phase} round=${round.round}`,
    );
    return job;
  }

  private async findCompleteRound(
    turnId: string,
  ): Promise<AnalyzeRoundJobData | null> {
    const repository = this.dataSource.getRepository(DebateTurnEntity);
    const requestedTurn = await repository.findOne({ where: { id: turnId } });
    if (!requestedTurn) return null;

    const turns = await repository.find({
      select: { id: true, sequence: true, analysisStatus: true },
      where: {
        debateId: requestedTurn.debateId,
        phase: requestedTurn.phase,
        round: requestedTurn.round,
      },
      order: { sequence: "ASC" },
    });
    if (
      turns.length !== 2 ||
      turns.some(
        (turn) => turn.analysisStatus !== DebateTurnAnalysisStatus.PENDING,
      )
    ) {
      return null;
    }

    const incompletePredecessorCount = await repository.count({
      where: {
        debateId: requestedTurn.debateId,
        sequence: LessThan(turns[0].sequence),
        analysisStatus: Not(DebateTurnAnalysisStatus.COMPLETED),
      },
    });
    if (incompletePredecessorCount > 0) return null;

    return {
      anchorTurnId: turns[0].id,
      debateId: requestedTurn.debateId,
      phase: requestedTurn.phase,
      round: requestedTurn.round,
    };
  }

  private buildJobId(round: AnalyzeRoundJobData): string {
    return [
      ANALYZE_ROUND_JOB,
      round.debateId,
      round.phase.toLowerCase(),
      round.round,
    ].join("-");
  }
}
