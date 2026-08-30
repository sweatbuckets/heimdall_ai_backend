import { Injectable } from "@nestjs/common";

export type DebateProcessingStage = "ANALYZER" | "FACT_CHECK" | "JUDGE";
export type DebateProcessingStatus =
  | "STARTED"
  | "RETRYING"
  | "COMPLETED"
  | "FAILED";

export interface DebateProcessingEvent {
  type: "debate.processing.stage";
  id: string;
  debateId: string;
  stage: DebateProcessingStage;
  status: DebateProcessingStatus;
  attempt: number;
  message: string;
  occurredAt: string;
}

type Listener = (event: DebateProcessingEvent) => void;

@Injectable()
export class DebateProcessingEventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: DebateProcessingEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

