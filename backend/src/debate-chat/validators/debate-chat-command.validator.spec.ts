import { DebatePhase, DebateSide } from "../../debates/domain/debate.enums";
import {
  DEBATE_TURN_FINALIZE_COMMAND,
  DEBATE_TURN_MESSAGE_SEND_COMMAND,
} from "../dto/debate-chat.dto";
import { DebateChatInputError } from "../errors/debate-chat.errors";
import { parseDebateChatCommand } from "./debate-chat-command.validator";

describe("parseDebateChatCommand", () => {
  it("parses a valid turn send command", () => {
    const command = parseDebateChatCommand(
      JSON.stringify({
        id: "command-1",
        type: DEBATE_TURN_MESSAGE_SEND_COMMAND,
        clientMessageId: "client-1",
        payload: {
          speakerId: "6d7df420-3f45-4025-81a9-756f71ae4d0e",
          speakerSide: DebateSide.SIDE_A,
          phase: DebatePhase.OPENING,
          round: 1,
          content: "  Debate turn content.  ",
        },
      }),
    );

    if (command.type !== DEBATE_TURN_MESSAGE_SEND_COMMAND) {
      throw new Error("Expected message send command.");
    }

    expect(command.payload.content).toBe("Debate turn content.");
    expect(command.payload.speakerSide).toBe(DebateSide.SIDE_A);
  });

  it("rejects invalid speakerSide values", () => {
    expect(() =>
      parseDebateChatCommand(
        JSON.stringify({
          id: "command-1",
          type: DEBATE_TURN_MESSAGE_SEND_COMMAND,
          payload: {
            speakerId: "6d7df420-3f45-4025-81a9-756f71ae4d0e",
            speakerSide: "A",
            phase: DebatePhase.OPENING,
            round: 1,
            content: "content",
          },
        }),
      ),
    ).toThrow(DebateChatInputError);
  });

  it("rejects blank content", () => {
    expect(() =>
      parseDebateChatCommand(
        JSON.stringify({
          id: "command-1",
          type: DEBATE_TURN_MESSAGE_SEND_COMMAND,
          payload: {
            speakerId: "6d7df420-3f45-4025-81a9-756f71ae4d0e",
            speakerSide: DebateSide.SIDE_A,
            phase: DebatePhase.OPENING,
            round: 1,
            content: "   ",
          },
        }),
      ),
    ).toThrow(DebateChatInputError);
  });

  it("parses a valid turn finalize command", () => {
    const command = parseDebateChatCommand(
      JSON.stringify({
        id: "command-2",
        type: DEBATE_TURN_FINALIZE_COMMAND,
        payload: {
          speakerId: "6d7df420-3f45-4025-81a9-756f71ae4d0e",
          speakerSide: DebateSide.SIDE_A,
          phase: DebatePhase.OPENING,
          round: 1,
        },
      }),
    );

    expect(command.type).toBe(DEBATE_TURN_FINALIZE_COMMAND);
    expect(command.payload.speakerSide).toBe(DebateSide.SIDE_A);
  });
});
