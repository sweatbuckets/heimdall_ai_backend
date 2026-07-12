export class JudgeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeInputError";
  }
}

export class InvalidJudgeOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJudgeOutputError";
  }
}

export class JudgeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeConflictError";
  }
}
