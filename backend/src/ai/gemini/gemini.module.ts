import { Module } from "@nestjs/common";
import { GEMINI_CLIENT } from "./gemini.constants";
import { geminiClientProvider } from "./gemini-client.provider";

@Module({
  providers: [geminiClientProvider],
  exports: [GEMINI_CLIENT],
})
export class GeminiModule {}
