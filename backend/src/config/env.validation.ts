import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "local", "production", "test")
    .default("development"),
  PORT: Joi.number().port().default(3000),
  DEBATE_CHAT_WS_PORT: Joi.number().port().default(8080),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgresql", "postgres"] })
    .required(),

  REDIS_HOST: Joi.string().default("localhost"),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow("").optional(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).default(900),
  JWT_REFRESH_TTL_SECONDS: Joi.number().integer().min(300).default(2592000),

  GEMINI_API_KEY: Joi.string().allow("").optional(),
  GEMINI_ANALYZER_MODEL: Joi.string().default("gemini-3.6-flash"),
  GEMINI_FACT_CHECKER_MODEL: Joi.string().default("gemini-3.6-flash"),
  GEMINI_JUDGE_MODEL: Joi.string().default("gemini-3.6-flash"),
  GEMINI_ANALYZER_THINKING_LEVEL: Joi.string()
    .valid("LOW", "MEDIUM", "HIGH")
    .default("MEDIUM"),
  GEMINI_FACT_CHECK_GROUNDING_THINKING_LEVEL: Joi.string()
    .valid("LOW", "MEDIUM", "HIGH")
    .default("LOW"),
  GEMINI_FACT_CHECK_SYNTHESIS_THINKING_LEVEL: Joi.string()
    .valid("LOW", "MEDIUM", "HIGH")
    .default("LOW"),
  GEMINI_JUDGE_THINKING_LEVEL: Joi.string()
    .valid("LOW", "MEDIUM", "HIGH")
    .default("MEDIUM"),
  GEMINI_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(90000),
  GEMINI_ANALYZER_TIMEOUT_MS: Joi.number().integer().min(1000).default(70000),
  GEMINI_FACT_CHECK_GROUNDING_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(90000),
  GEMINI_FACT_CHECK_SYNTHESIS_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(70000),
  GEMINI_JUDGE_TIMEOUT_MS: Joi.number().integer().min(1000).default(40000),
  DEBATE_TURN_MAX_CONTENT_LENGTH: Joi.number()
    .integer()
    .min(1)
    .default(500),
  ANALYZER_MAX_COMPONENTS_PER_TURN: Joi.number().integer().min(1).default(10),
  ANALYZER_MAX_FACT_CHECK_TARGETS_PER_TURN: Joi.number()
    .integer()
    .min(1)
    .default(5),
  ANALYZER_MAX_COMPONENT_STATEMENT_LENGTH: Joi.number()
    .integer()
    .min(1)
    .default(1000),
  ANALYZER_RECOVERY_INTERVAL_MS: Joi.number()
    .integer()
    .min(1000)
    .default(30000),
  ANALYZER_PROCESSING_STALE_MS: Joi.number()
    .integer()
    .min(60000)
    .default(80000),

  FACT_CHECK_MAX_TARGETS_PER_BATCH: Joi.number().integer().min(1).default(10),
  FACT_CHECK_MAX_REASON_LENGTH: Joi.number().integer().min(1).default(2000),
  FACT_CHECK_MAX_SOURCES_PER_GROUNDING: Joi.number().integer().min(1).default(5),
  FACT_CHECK_MAX_SOURCES_PER_RESULT: Joi.number().integer().min(1).default(5),
  FACT_CHECK_ENABLED: Joi.boolean().truthy("true").falsy("false").default(true),
  FACT_CHECK_RECOVERY_INTERVAL_MS: Joi.number()
    .integer()
    .min(1000)
    .default(30000),
  FACT_CHECK_PROCESSING_STALE_MS: Joi.number()
    .integer()
    .min(60000)
    .default(200000),

  JUDGE_MAX_OVERALL_REASON_LENGTH: Joi.number().integer().min(1).default(3000),
  JUDGE_MAX_FEEDBACK_LENGTH: Joi.number().integer().min(1).default(1500),
  JUDGE_RECOVERY_INTERVAL_MS: Joi.number().integer().min(1000).default(30000),
  JUDGE_PROCESSING_STALE_MS: Joi.number().integer().min(60000).default(75000),
  JUDGE_MANUAL_RETRY_STALE_MS: Joi.number().integer().min(60000).default(75000),
});
