import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager } from "typeorm";
import {
  DEFAULT_MAX_JUDGE_FEEDBACK_LENGTH,
  DEFAULT_MAX_JUDGE_OVERALL_REASON_LENGTH,
} from "./constants";
import { JudgeInputAssembler } from "./judge-input.assembler";
import { JudgeAiService } from "./judge-ai.service";
import { mapJudgeOutputToJudgmentResult } from "./mappers/judgment-result.mapper";
import { validateJudgeInput } from "./validators/judge-input.validator";
import { validateJudgeOutput } from "./validators/judge-output.validator";
import { JudgeConflictError } from "./errors/judge.errors";
import {
  DebateStatus,
  JudgeTaskStatus,
  JudgmentWinner,
} from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";
import { JudgeTaskEntity } from "../debates/entities/judge-task.entity";
import {
  AiInvocationCancellationService,
  AiInvocationCancelledError,
} from "../ai/ai-invocation-cancellation.service";
import { CommunityEntity } from "../community-chat/entities/community.entity";
import { CommunityStatus } from "../community-chat/domain/community-chat.enums";
import { MemberEntity } from "../members/entities/member.entity";
import { DEBATE_WIN_SCORE_REWARD } from "../members/member-score.constants";
import { CommunityNotificationService } from "../community-chat/community-notification.service";

export interface JudgeDebateResult {
  debateId: string;
  judgmentResultId: string;
}

@Injectable()
export class JudgeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly judgeInputAssembler: JudgeInputAssembler,
    private readonly judgeAiService: JudgeAiService,
    private readonly configService: ConfigService,
    private readonly aiCancellationService: AiInvocationCancellationService,
    private readonly communityNotificationService: CommunityNotificationService,
  ) {}

  async judgeDebate(
    debateId: string,
    judgeTaskId: string,
  ): Promise<JudgeDebateResult> {
    const assembled = await this.judgeInputAssembler.assemble(debateId);

    validateJudgeInput(assembled.input, assembled.validationContext);

    const output = await this.aiCancellationService.run(debateId, (signal) =>
      this.judgeAiService.judge(assembled.input, signal),
    );
    validateJudgeOutput(output, {
      maxOverallReasonLength: this.configService.get<number>(
        "JUDGE_MAX_OVERALL_REASON_LENGTH",
        DEFAULT_MAX_JUDGE_OVERALL_REASON_LENGTH,
      ),
      maxFeedbackLength: this.configService.get<number>(
        "JUDGE_MAX_FEEDBACK_LENGTH",
        DEFAULT_MAX_JUDGE_FEEDBACK_LENGTH,
      ),
    });

    const judgmentResult = mapJudgeOutputToJudgmentResult(
      debateId,
      output,
      new Date(),
    );

    const communityNotification = await this.dataSource.transaction(
      async (manager) => {
        const debate = await manager.findOne(DebateEntity, {
          where: { id: debateId },
          lock: { mode: "pessimistic_write" },
        });
        if (!debate || debate.status === DebateStatus.FAILED) {
          throw new AiInvocationCancelledError(debateId);
        }
        const judgeTask = await manager.findOne(JudgeTaskEntity, {
          where: { id: judgeTaskId },
          lock: { mode: "pessimistic_write" },
        });
        if (
          !judgeTask ||
          judgeTask.debateId !== debateId ||
          judgeTask.status !== JudgeTaskStatus.PROCESSING
        ) {
          throw new JudgeConflictError(
            `JudgeTask completion state changed: ${judgeTaskId}.`,
          );
        }

        await manager.insert(JudgmentResultEntity, judgmentResult);

        const updateResult = await manager
          .createQueryBuilder()
          .update(DebateEntity)
          .set({
            status: DebateStatus.COMPLETED,
            endedAt: new Date(),
            judgingStartedAt: null,
          })
          .where("id = :debateId", { debateId })
          .andWhere("status = :status", { status: DebateStatus.JUDGING })
          .execute();

        if (updateResult.affected !== 1) {
          throw new JudgeConflictError(
            `Debate could not be completed from JUDGING: ${debateId}.`,
          );
        }
        const completedAt = new Date();
        const taskUpdate = await manager.update(
          JudgeTaskEntity,
          { id: judgeTaskId, status: JudgeTaskStatus.PROCESSING },
          {
            status: JudgeTaskStatus.COMPLETED,
            processingStartedAt: null,
            completedAt,
          },
        );
        if (taskUpdate.affected !== 1) {
          throw new JudgeConflictError(
            `JudgeTask could not be completed: ${judgeTaskId}.`,
          );
        }
        if (!judgmentResult.winner) {
          throw new JudgeConflictError("Judgment winner was not generated.");
        }
        await this.awardWinnerScore(manager, debate, judgmentResult.winner);
        await manager.update(
          CommunityEntity,
          { id: debate.communityId },
          { status: CommunityStatus.WAITING },
        );
        return this.communityNotificationService.createDebateResult(
          manager,
          debate.communityId,
          debateId,
        );
      },
    );
    this.communityNotificationService.publish(communityNotification);

    if (!judgmentResult.id) {
      throw new JudgeConflictError("JudgmentResult id was not generated.");
    }

    return {
      debateId,
      judgmentResultId: judgmentResult.id,
    };
  }

  private async awardWinnerScore(
    manager: EntityManager,
    debate: DebateEntity,
    winner: JudgmentWinner,
  ): Promise<void> {
    const winnerMemberId =
      winner === JudgmentWinner.SIDE_A
        ? debate.sideASpeakerId
        : winner === JudgmentWinner.SIDE_B
          ? debate.sideBSpeakerId
          : null;
    if (!winnerMemberId) return;

    const result = await manager.increment(
      MemberEntity,
      { id: winnerMemberId },
      "score",
      DEBATE_WIN_SCORE_REWARD,
    );
    if (result.affected !== 1) {
      throw new JudgeConflictError(
        `Winner score could not be updated: ${winnerMemberId}.`,
      );
    }
  }
}
