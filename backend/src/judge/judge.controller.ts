import {
  BadGatewayException,
  ConflictException,
  Controller,
  Param,
  Post,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { assertUuid } from "../common/http/id.validator";
import { JudgmentResultEntity } from "../debates/entities/judgment-result.entity";
import {
  JudgmentResultResponseDto,
  mapJudgmentResultResponse,
} from "./dto/judgment-result-response.dto";
import {
  InvalidJudgeOutputError,
  JudgeConflictError,
  JudgeInputError,
} from "./errors/judge.errors";
import { JudgeReadinessService } from "./judge-readiness.service";

@Controller("debates/:debateId/judge")
export class JudgeController {
  constructor(
    private readonly judgeReadinessService: JudgeReadinessService,
    @InjectRepository(JudgmentResultEntity)
    private readonly judgmentResultRepository: Repository<JudgmentResultEntity>,
  ) {}

  @Post()
  async judgeDebate(
    @Param("debateId") debateId: string,
  ): Promise<JudgmentResultResponseDto> {
    assertUuid(debateId, "debateId");

    try {
      await this.judgeReadinessService.tryStartJudge(debateId);
    } catch (error) {
      throw mapJudgeHttpError(error);
    }

    return this.getJudgmentResultOrThrow(debateId);
  }

  @Post("retry")
  async retryJudge(
    @Param("debateId") debateId: string,
  ): Promise<JudgmentResultResponseDto> {
    assertUuid(debateId, "debateId");

    try {
      await this.judgeReadinessService.tryStartJudge(debateId);
      await this.judgeReadinessService.retryStaleJudge(debateId);
    } catch (error) {
      throw mapJudgeHttpError(error);
    }

    return this.getJudgmentResultOrThrow(debateId);
  }

  private async getJudgmentResultOrThrow(
    debateId: string,
  ): Promise<JudgmentResultResponseDto> {
    const judgmentResult = await this.judgmentResultRepository.findOne({
      where: { debateId },
    });

    if (!judgmentResult) {
      throw new ConflictException(
        "Judge is still running or is not eligible for retry.",
      );
    }

    return mapJudgmentResultResponse(judgmentResult);
  }
}

function mapJudgeHttpError(error: unknown): Error {
  if (error instanceof JudgeInputError) {
    return new ConflictException(error.message);
  }

  if (error instanceof JudgeConflictError) {
    return new ConflictException(error.message);
  }

  if (error instanceof InvalidJudgeOutputError) {
    return new BadGatewayException(error.message);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unexpected judge error.");
}
