import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { assertUuid } from "../common/http/id.validator";
import { DebateStatus } from "./domain/debate.enums";
import { DebateDetailDto, DebateDto, DebateResultDto } from "./dto/debate.dto";
import { DebatesService } from "./debates.service";
import { validateCreateDebateRequest } from "./validators/create-debate.validator";

@Controller("debates")
export class DebatesController {
  constructor(private readonly debatesService: DebatesService) {}

  @Post()
  async createDebate(@Body() body: unknown): Promise<DebateDto> {
    return this.debatesService.createDebate(validateCreateDebateRequest(body));
  }

  @Get()
  async listDebates(@Query("status") status?: string): Promise<DebateDto[]> {
    return this.debatesService.listDebates(parseDebateStatus(status));
  }

  @Get(":debateId")
  async getDebate(
    @Param("debateId") debateId: string,
  ): Promise<DebateDetailDto> {
    assertUuid(debateId, "debateId");

    return this.debatesService.getDebateDetail(debateId);
  }

  @Get(":debateId/result")
  async getDebateResult(
    @Param("debateId") debateId: string,
  ): Promise<DebateResultDto> {
    assertUuid(debateId, "debateId");

    return this.debatesService.getDebateResult(debateId);
  }

  @Post(":debateId/start")
  async startDebate(@Param("debateId") debateId: string): Promise<DebateDto> {
    assertUuid(debateId, "debateId");

    return this.debatesService.startDebate(debateId);
  }

  @Post(":debateId/judging")
  async transitionToJudging(
    @Param("debateId") debateId: string,
  ): Promise<DebateDto> {
    assertUuid(debateId, "debateId");

    return this.debatesService.transitionToJudging(debateId);
  }
}

function parseDebateStatus(
  status: string | undefined,
): DebateStatus | undefined {
  if (!status) {
    return undefined;
  }

  const allowedStatuses = Object.values(DebateStatus);

  if (!allowedStatuses.includes(status as DebateStatus)) {
    throw new BadRequestException(
      `status must be one of: ${allowedStatuses.join(", ")}.`,
    );
  }

  return status as DebateStatus;
}
