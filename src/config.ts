export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  apiKey: process.env.BRAINIA_API_KEY,
  clientKeys: process.env.BRAINIA_CLIENT_KEYS,
  processingMode: process.env.BRAINIA_PROCESSING_MODE === "queued" ? "queued" : "inline",
  workerBatchSize: Math.min(25, Math.max(1, Number(process.env.BRAINIA_WORKER_BATCH_SIZE ?? 10))),
} as const;
