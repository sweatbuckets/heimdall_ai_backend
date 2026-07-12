import {
  BadGatewayException,
  ConflictException,
  Controller,
  InternalServerErrorException,
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
import { JudgeService } from "./judge.service";

@Controller("debates/:debateId/judge")
export class JudgeController {
  constructor(
    private readonly judgeService: JudgeService,
    @InjectRepository(JudgmentResultEntity)
    private readonly judgmentResultRepository: Repository<JudgmentResultEntity>,
  ) {}

  @Post()
  async judgeDebate(
    @Param("debateId") debateId: string,
  ): Promise<JudgmentResultResponseDto> {
    assertUuid(debateId, "debateId");

    let judgmentResultId: string;

    try {
      const result = await this.judgeService.judgeDebate(debateId);
      judgmentResultId = result.judgmentResultId;
    } catch (error) {
      throw mapJudgeHttpError(error);
    }

    const judgmentResult = await this.judgmentResultRepository.findOne({
      where: { id: judgmentResultId },
    });

    if (!judgmentResult) {
      throw new InternalServerErrorException("JudgmentResult was not found.");
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
