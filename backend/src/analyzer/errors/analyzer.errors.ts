export class AnalyzeTurnInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeTurnInputError";
  }
}

export class InvalidAnalyzeTurnOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnalyzeTurnOutputError";
  }
}

export class AnalyzeTurnConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeTurnConflictError";
  }
}
