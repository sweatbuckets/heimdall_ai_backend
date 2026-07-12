import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FactCheckBatchInput } from "./dto/fact-check-batch.dto";
import { NonRetryableFactCheckError } from "./errors/fact-check.errors";
import { FactCheckBatchTaskEntity } from "../debates/entities/fact-check-batch-task.entity";

@Injectable()
export class FactCheckInputAssembler {
  constructor(
    @InjectRepository(FactCheckBatchTaskEntity)
    private readonly factCheckBatchTaskRepository: Repository<FactCheckBatchTaskEntity>,
  ) {}

  async assemble(factCheckBatchTaskId: string): Promise<FactCheckBatchInput> {
    const task = await this.factCheckBatchTaskRepository
      .createQueryBuilder("task")
      .innerJoinAndSelect("task.turn", "turn")
      .innerJoinAndSelect("turn.debate", "debate")
      .innerJoinAndSelect("task.targets", "target")
      .innerJoinAndSelect("target.component", "component")
      .where("task.id = :taskId", { taskId: factCheckBatchTaskId })
      .orderBy("target.created_at", "ASC")
      .getOne();

    if (!task) {
      throw new NonRetryableFactCheckError(
        `FactCheckBatchTask not found: ${factCheckBatchTaskId}.`,
      );
    }

    if (!task.targets.length) {
      throw new NonRetryableFactCheckError(
        `FactCheckBatchTask has no targets: ${factCheckBatchTaskId}.`,
      );
    }

    for (const target of task.targets) {
      if (!target.component) {
        throw new NonRetryableFactCheckError(
          `FactCheckBatchTarget has no component: ${target.id}.`,
        );
      }

      if (target.component.turnId !== task.turnId) {
        throw new NonRetryableFactCheckError(
          `FactCheckBatchTarget component belongs to another turn: ${target.componentId}.`,
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
        id: task.turn.debate.id,
        topic: task.turn.debate.topic,
      },
      turn: {
        id: task.turn.id,
        sequence: task.turn.sequence,
      },
      targets: task.targets.map((target) => ({
        componentId: target.component.id,
        statement: target.component.statement,
      })),
    };
  }
}
