import { Injectable } from "@nestjs/common";
import { Job } from "bullmq";
import { DataSource } from "typeorm";
import { AiInvocationCancelledError } from "../ai/ai-invocation-cancellation.service";
import { JudgeTaskStatus } from "../debates/domain/debate.enums";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";
import { JudgeTaskEntity } from "../debates/entities/judge-task.entity";
import {
  isFinalJudgeAttempt,
  toJudgeErrorCode,
  toJudgeFailureReason,
} from "./judge-task-state.util";
import { JudgeService } from "./judge.service";
import { JudgeJobData } from "./queues/judge.constants";

@Injectable()
export class JudgeTaskService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly judgeService: JudgeService,
  ) {}

  async process(taskId: string, job?: Job<JudgeJobData>): Promise<void> {
    if (!(await this.claimTask(taskId))) {
      await this.reconcileUnclaimedTask(taskId);
      return;
    }

    try {
      const task = await this.dataSource
        .getRepository(JudgeTaskEntity)
        .findOne({
          where: { id: taskId },
        });
      if (!task) throw new Error(`JudgeTask not found: ${taskId}.`);
      await this.judgeService.judgeDebate(task.debateId, task.id);
    } catch (error) {
      await this.handleFailure(taskId, job, error);
      if (error instanceof AiInvocationCancelledError) return;
      throw error;
    }
  }

  private async claimTask(taskId: string): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(JudgeTaskEntity)
      .set({
        status: JudgeTaskStatus.PROCESSING,
        processingStartedAt: new Date(),
        attemptCount: () => '"attempt_count" + 1',
        lastErrorCode: null,
        failureReason: null,
      })
      .where("id = :taskId", { taskId })
      .andWhere("status = :status", { status: JudgeTaskStatus.PENDING })
      .execute();
    return result.affected === 1;
  }

  private async reconcileUnclaimedTask(taskId: string): Promise<void> {
    const task = await this.dataSource.getRepository(JudgeTaskEntity).findOne({
      where: { id: taskId },
    });
    if (!task) throw new Error(`JudgeTask not found: ${taskId}.`);
    if (task.status === JudgeTaskStatus.COMPLETED) return;

    const hasResult =
      (await this.dataSource.getRepository(JudgmentResultEntity).count({
        where: { debateId: task.debateId },
      })) > 0;
    if (hasResult) {
      await this.dataSource.getRepository(JudgeTaskEntity).update(
        { id: taskId },
        {
          status: JudgeTaskStatus.COMPLETED,
          processingStartedAt: null,
          completedAt: new Date(),
        },
      );
    }
  }

  private async handleFailure(
    taskId: string,
    job: Job<JudgeJobData> | undefined,
    error: unknown,
  ): Promise<void> {
    const finalFailure =
      error instanceof AiInvocationCancelledError || isFinalJudgeAttempt(job);
    await this.dataSource.getRepository(JudgeTaskEntity).update(
      { id: taskId, status: JudgeTaskStatus.PROCESSING },
      {
        status: finalFailure ? JudgeTaskStatus.FAILED : JudgeTaskStatus.PENDING,
        processingStartedAt: null,
        lastErrorCode: toJudgeErrorCode(error),
        failureReason: toJudgeFailureReason(error),
      },
    );
  }
}
