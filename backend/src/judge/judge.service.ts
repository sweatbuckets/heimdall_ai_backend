import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
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
import { DebateStatus } from "../debates/domain/debate.enums";
import { DebateEntity } from "../debates/entities/debate.entity";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";

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
  ) {}

  async judgeDebate(debateId: string): Promise<JudgeDebateResult> {
    const assembled = await this.judgeInputAssembler.assemble(debateId);

    validateJudgeInput(assembled.input, assembled.validationContext);

    const output = await this.judgeAiService.judge(assembled.input);
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

    await this.dataSource.transaction(async (manager) => {
      await manager.insert(JudgmentResultEntity, judgmentResult);

      const updateResult = await manager
        .createQueryBuilder()
        .update(DebateEntity)
        .set({
          status: DebateStatus.COMPLETED,
          endedAt: new Date(),
        })
        .where("id = :debateId", { debateId })
        .andWhere("status = :status", { status: DebateStatus.JUDGING })
        .execute();

      if (updateResult.affected !== 1) {
        throw new JudgeConflictError(
          `Debate could not be completed from JUDGING: ${debateId}.`,
        );
      }
    });

    if (!judgmentResult.id) {
      throw new JudgeConflictError("JudgmentResult id was not generated.");
    }

    return {
      debateId,
      judgmentResultId: judgmentResult.id,
    };
  }
}
