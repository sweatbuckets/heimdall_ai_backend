export const FACT_CHECK_BATCH_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["componentId", "status", "reason", "sourceIndexes"],
        properties: {
          componentId: { type: "string" },
          status: {
            type: "string",
            enum: [
              "SUPPORTED",
              "CONTRADICTED",
              "PARTIALLY_SUPPORTED",
              "INSUFFICIENT_EVIDENCE",
              "NOT_VERIFIABLE",
              "OUTDATED_OR_TIME_SENSITIVE",
            ],
          },
          reason: { type: "string" },
          sourceIndexes: {
            type: "array",
            items: {
              type: "integer",
            },
          },
        },
      },
    },
  },
} as const;
