export class GeminiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigurationError";
  }
}

export class InvalidGeminiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGeminiResponseError";
  }
}
