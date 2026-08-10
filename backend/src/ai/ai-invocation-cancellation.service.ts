import { Injectable } from "@nestjs/common";

export class AiInvocationCancelledError extends Error {
  constructor(readonly debateId: string) {
    super(`AI invocation cancelled for debate: ${debateId}.`);
    this.name = "AiInvocationCancelledError";
  }
}

@Injectable()
export class AiInvocationCancellationService {
  private readonly controllers = new Map<string, Set<AbortController>>();

  async run<T>(
    debateId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const debateControllers = this.controllers.get(debateId) ?? new Set();
    debateControllers.add(controller);
    this.controllers.set(debateId, debateControllers);

    try {
      return await operation(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AiInvocationCancelledError(debateId);
      }
      throw error;
    } finally {
      debateControllers.delete(controller);
      if (debateControllers.size === 0) {
        this.controllers.delete(debateId);
      }
    }
  }

  cancelDebate(debateId: string): number {
    const debateControllers = this.controllers.get(debateId);
    if (!debateControllers) return 0;

    for (const controller of debateControllers) {
      controller.abort(new AiInvocationCancelledError(debateId));
    }
    return debateControllers.size;
  }
}
