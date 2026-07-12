import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_CLIENT } from "./gemini.constants";

const MISSING_GEMINI_API_KEY_PLACEHOLDER = "missing-gemini-api-key";

export const geminiClientProvider: Provider<GoogleGenAI> = {
  provide: GEMINI_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): GoogleGenAI => {
    const apiKey = configService.get<string>("GEMINI_API_KEY");

    return new GoogleGenAI({
      apiKey: apiKey || MISSING_GEMINI_API_KEY_PLACEHOLDER,
    });
  },
};
