import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { assertUuid } from "../common/http/id.validator";
import { AuthPrincipal } from "../auth/dto/auth.dto";
import { CurrentMember } from "../auth/current-member.decorator";
import { DebateStatus } from "./domain/debate.enums";
import {
  DebateTurnVoteSummaryDto,
  DebateTurnWithVotesDto,
} from "./dto/debate-turn-vote.dto";
import { DebateDetailDto, DebateDto, DebateResultDto } from "./dto/debate.dto";
import { DebatesService } from "./debates.service";
import { validateCreateDebateRequest } from "./validators/create-debate.validator";
import { validateSetDebateTurnVoteRequest } from "./validators/debate-turn-vote.validator";

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

  @Get(":debateId/turns")
  async getDebateTurns(
    @Param("debateId") debateId: string,
  ): Promise<DebateTurnWithVotesDto[]> {
    assertUuid(debateId, "debateId");

    return this.debatesService.getDebateTurns(debateId);
  }

  @Put(":debateId/turns/:turnId/vote")
  async setDebateTurnVote(
    @Param("debateId") debateId: string,
    @Param("turnId") turnId: string,
    @CurrentMember() principal: AuthPrincipal,
    @Body() body: unknown,
  ): Promise<DebateTurnVoteSummaryDto> {
    assertUuid(debateId, "debateId");
    assertUuid(turnId, "turnId");

    const input = validateSetDebateTurnVoteRequest(body);
    return this.debatesService.setDebateTurnVote(
      debateId,
      turnId,
      principal.memberId,
      input.type,
    );
  }

  @Delete(":debateId/turns/:turnId/vote")
  async removeDebateTurnVote(
    @Param("debateId") debateId: string,
    @Param("turnId") turnId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<DebateTurnVoteSummaryDto> {
    assertUuid(debateId, "debateId");
    assertUuid(turnId, "turnId");

    return this.debatesService.removeDebateTurnVote(
      debateId,
      turnId,
      principal.memberId,
    );
  }

  @Get(":debateId")
  async getDebate(
    @Param("debateId") debateId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<DebateDetailDto> {
    assertUuid(debateId, "debateId");

    return this.debatesService.getDebateDetail(debateId, principal.memberId);
  }

  @Get(":debateId/result")
  async getDebateResult(
    @Param("debateId") debateId: string,
    @CurrentMember() principal: AuthPrincipal,
  ): Promise<DebateResultDto> {
    assertUuid(debateId, "debateId");

    return this.debatesService.getDebateResult(debateId, principal.memberId);
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
