export class FactCheckInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactCheckInputError";
  }
}

export class InvalidFactCheckOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFactCheckOutputError";
  }
}

export class FactCheckConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactCheckConflictError";
  }
}

export class NonRetryableFactCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableFactCheckError";
  }
}
