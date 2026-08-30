import { Injectable } from "@nestjs/common";

export interface FactCheckCompletedEvent {
  type: "fact-check.completed";
  debateId: string;
  factCheckBatchId: string;
  occurredAt: string;
}

type Listener = (event: FactCheckCompletedEvent) => void;

@Injectable()
export class DebatePipelineEventBus {
  private readonly listeners = new Set<Listener>();
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(event: FactCheckCompletedEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
