import { GenerateContentResponse } from "@google/genai";
import { InvalidGeminiResponseError } from "../ai/gemini/gemini.errors";
import {
  GroundedEvidenceBundle,
  GroundedSource,
} from "./dto/fact-check-batch.dto";

interface CandidateWithGrounding {
  groundingMetadata?: {
    groundingChunks?: Array<{
      web?: {
        title?: string;
        uri?: string;
      };
    }>;
    webSearchQueries?: string[];
  };
}

export function extractGroundedEvidence(
  response: GenerateContentResponse,
  maxSources: number,
): GroundedEvidenceBundle {
  const candidate = response.candidates?.[0] as
    CandidateWithGrounding | undefined;

  if (!candidate) {
    throw new InvalidGeminiResponseError(
      "Gemini returned no grounded candidate.",
    );
  }

  const metadata = candidate.groundingMetadata;
  const rawSources =
    metadata?.groundingChunks?.flatMap((chunk) => {
      const uri = chunk.web?.uri?.trim();

      if (!uri || !isHttpUrl(uri)) {
        return [];
      }

      const title = chunk.web?.title?.trim() || uri;

      return [
        {
          title,
          publisher: extractPublisher(uri),
          url: uri,
        },
      ];
    }) ?? [];

  const sources = deduplicateSources(rawSources)
    .slice(0, maxSources)
    .map((source, index) => ({
      sourceIndex: index,
      ...source,
    }));

  if (sources.length === 0) {
    throw new InvalidGeminiResponseError(
      "Gemini grounding metadata did not include usable web sources.",
    );
  }

  return {
    evidenceText: response.text?.trim() ?? "",
    webSearchQueries: metadata?.webSearchQueries ?? [],
    sources,
  };
}

function deduplicateSources(
  sources: Array<Omit<GroundedSource, "sourceIndex">>,
): Array<Omit<GroundedSource, "sourceIndex">> {
  const seenUrls = new Set<string>();
  const uniqueSources: Array<Omit<GroundedSource, "sourceIndex">> = [];

  for (const source of sources) {
    if (seenUrls.has(source.url)) {
      continue;
    }

    seenUrls.add(source.url);
    uniqueSources.push(source);
  }

  return uniqueSources;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractPublisher(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
