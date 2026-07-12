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

  GEMINI_API_KEY: Joi.string().allow("").optional(),
  GEMINI_ANALYZER_MODEL: Joi.string().default("gemini-3.5-flash"),
  GEMINI_FACT_CHECKER_MODEL: Joi.string().default("gemini-3.5-flash"),
  GEMINI_JUDGE_MODEL: Joi.string().default("gemini-3.5-flash"),
  GEMINI_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(60000),
  GEMINI_MAX_RETRIES: Joi.number().integer().min(0).default(3),

  ANALYZER_MAX_COMPONENTS_PER_TURN: Joi.number().integer().min(1).default(10),
  ANALYZER_MAX_FACT_CHECK_TARGETS_PER_TURN: Joi.number()
    .integer()
    .min(1)
    .default(5),
  ANALYZER_MAX_COMPONENT_STATEMENT_LENGTH: Joi.number()
    .integer()
    .min(1)
    .default(1000),

  FACT_CHECK_MAX_TARGETS_PER_BATCH: Joi.number().integer().min(1).default(5),
  FACT_CHECK_MAX_REASON_LENGTH: Joi.number().integer().min(1).default(2000),
  FACT_CHECK_MAX_SOURCES_PER_RESULT: Joi.number().integer().min(1).default(5),
  FACT_CHECK_ENABLED: Joi.boolean().truthy("true").falsy("false").default(true),

  JUDGE_MAX_OVERALL_REASON_LENGTH: Joi.number().integer().min(1).default(3000),
  JUDGE_MAX_FEEDBACK_LENGTH: Joi.number().integer().min(1).default(1500),
});
