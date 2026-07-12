export class DebateChatInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebateChatInputError";
  }
}

export class DebateChatStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebateChatStateError";
  }
}
