import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  FactCheckBatchInput,
  GroundedEvidenceBundle,
} from "./dto/fact-check-batch.dto";
import { NonRetryableFactCheckError } from "./errors/fact-check.errors";
import { FactCheckBatchEntity } from "../debates/entities/fact-check-batch.entity";
import { FactCheckGroundingSnapshotEntity } from "../debates/entities/fact-check-grounding-snapshot.entity";
import { FactCheckStageTaskEntity } from "../debates/entities/fact-check-stage-task.entity";
import { FactCheckStage } from "../debates/domain/debate.enums";

@Injectable()
export class FactCheckInputAssembler {
  constructor(
    @InjectRepository(FactCheckBatchEntity)
    private readonly factCheckBatchRepository: Repository<FactCheckBatchEntity>,
    @InjectRepository(FactCheckGroundingSnapshotEntity)
    private readonly groundingSnapshotRepository: Repository<FactCheckGroundingSnapshotEntity>,
    @InjectRepository(FactCheckStageTaskEntity)
    private readonly stageTaskRepository: Repository<FactCheckStageTaskEntity>,
  ) {}

  async assembleForTask(
    taskId: string,
    expectedStage: FactCheckStage,
  ): Promise<FactCheckBatchInput> {
    const task = await this.stageTaskRepository.findOne({
      where: { id: taskId },
    });
    if (!task || task.stage !== expectedStage) {
      throw new NonRetryableFactCheckError(
        `FactCheckStageTask is missing or has an invalid stage: ${taskId}.`,
      );
    }
    return this.assemble(task.factCheckBatchId);
  }

  async assemble(factCheckBatchId: string): Promise<FactCheckBatchInput> {
    const batch = await this.factCheckBatchRepository
      .createQueryBuilder("batch")
      .innerJoinAndSelect("batch.debate", "debate")
      .innerJoinAndSelect("batch.targets", "target")
      .innerJoinAndSelect("target.component", "component")
      .innerJoinAndSelect("component.turn", "turn")
      .where("batch.id = :batchId", { batchId: factCheckBatchId })
      .orderBy("target.created_at", "ASC")
      .getOne();

    if (!batch) {
      throw new NonRetryableFactCheckError(
        `FactCheckBatch not found: ${factCheckBatchId}.`,
      );
    }

    if (!batch.targets.length) {
      throw new NonRetryableFactCheckError(
        `FactCheckBatch has no targets: ${factCheckBatchId}.`,
      );
    }

    for (const target of batch.targets) {
      if (!target.component?.turn) {
        throw new NonRetryableFactCheckError(
          `FactCheckBatchTarget has no component turn: ${target.id}.`,
        );
      }

      if (target.component.turn.debateId !== batch.debateId) {
        throw new NonRetryableFactCheckError(
          `FactCheckBatchTarget belongs to another debate: ${target.componentId}.`,
        );
      }

      if (
        target.component.turn.phase !== batch.phase ||
        target.component.turn.round !== batch.round
      ) {
        throw new NonRetryableFactCheckError(
          `FactCheckBatchTarget belongs to another round: ${target.componentId}.`,
        );
      }

      if (!target.component.requiresFactCheck) {
        throw new NonRetryableFactCheckError(
          `FactCheckBatchTarget component does not require fact check: ${target.componentId}.`,
        );
      }
    }

    return {
      debate: {
        id: batch.debate.id,
        topic: batch.debate.topic,
      },
      round: {
        phase: batch.phase,
        number: batch.round,
      },
      targets: batch.targets.map((target) => ({
        componentId: target.component.id,
        statement: target.component.statement,
        turnId: target.component.turn.id,
        sequence: target.component.turn.sequence,
        speakerSide: target.component.turn.speakerSide,
      })),
    };
  }

  async assembleSynthesis(factCheckBatchId: string): Promise<{
    input: FactCheckBatchInput;
    groundedEvidence: GroundedEvidenceBundle;
  }> {
    const [input, snapshot] = await Promise.all([
      this.assemble(factCheckBatchId),
      this.groundingSnapshotRepository.findOne({
        where: { factCheckBatchId },
      }),
    ]);

    if (!snapshot) {
      throw new NonRetryableFactCheckError(
        `FactCheckGroundingSnapshot not found: ${factCheckBatchId}.`,
      );
    }

    return {
      input,
      groundedEvidence: {
        evidenceText: snapshot.evidenceText,
        webSearchQueries: snapshot.webSearchQueries,
        sources: snapshot.sources,
      },
    };
  }

  async assembleSynthesisForTask(taskId: string): Promise<{
    input: FactCheckBatchInput;
    groundedEvidence: GroundedEvidenceBundle;
  }> {
    const task = await this.stageTaskRepository.findOne({
      where: { id: taskId },
    });
    if (!task || task.stage !== FactCheckStage.SYNTHESIS) {
      throw new NonRetryableFactCheckError(
        `FactCheckStageTask is missing or is not SYNTHESIS: ${taskId}.`,
      );
    }
    return this.assembleSynthesis(task.factCheckBatchId);
  }
}
