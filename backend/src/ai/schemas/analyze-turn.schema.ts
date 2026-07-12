export const ANALYZE_TURN_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "newComponents",
    "newArgumentalRelations",
    "newInteractionalRelations",
  ],
  properties: {
    newComponents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "localKey",
          "statement",
          "isMajorClaim",
          "requiresFactCheck",
        ],
        properties: {
          localKey: { type: "string" },
          statement: { type: "string" },
          isMajorClaim: { type: "boolean" },
          requiresFactCheck: { type: "boolean" },
        },
      },
    },
    newArgumentalRelations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "type"],
        properties: {
          from: {
            type: "object",
            additionalProperties: false,
            required: ["source", "localKey"],
            properties: {
              source: { type: "string", enum: ["NEW"] },
              localKey: { type: "string" },
            },
          },
          to: {
            type: "object",
            additionalProperties: false,
            required: ["source"],
            properties: {
              source: { type: "string", enum: ["NEW", "EXISTING"] },
              localKey: { type: "string" },
              componentId: { type: "string" },
            },
          },
          type: {
            type: "string",
            enum: ["SUPPORTS", "ATTACKS"],
          },
        },
      },
    },
    newInteractionalRelations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "type"],
        properties: {
          from: {
            type: "object",
            additionalProperties: false,
            required: ["source", "localKey"],
            properties: {
              source: { type: "string", enum: ["NEW"] },
              localKey: { type: "string" },
            },
          },
          to: {
            type: "object",
            additionalProperties: false,
            required: ["source"],
            properties: {
              source: { type: "string", enum: ["NEW", "EXISTING"] },
              localKey: { type: "string" },
              componentId: { type: "string" },
            },
          },
          type: {
            type: "string",
            enum: ["QUESTIONS", "ANSWERS"],
          },
        },
      },
    },
  },
} as const;
