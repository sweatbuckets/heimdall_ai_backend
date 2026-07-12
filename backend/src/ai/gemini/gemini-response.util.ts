import { InvalidGeminiResponseError } from "./gemini.errors";

export function parseRequiredJson<T>(text: string | undefined): T {
  if (!text || !text.trim()) {
    throw new InvalidGeminiResponseError("Gemini response text is empty.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new InvalidGeminiResponseError("Gemini response is not valid JSON.");
  }
}
