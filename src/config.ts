export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  apiKey: process.env.BRAINIA_API_KEY,
  clientKeys: process.env.BRAINIA_CLIENT_KEYS,
  // Environment values entered through deployment UIs can include whitespace.
  // Treat the mode as a token so a trailing newline cannot silently reactivate
  // synchronous model processing for capture requests.
  processingMode: process.env.BRAINIA_PROCESSING_MODE?.trim() === "queued" ? "queued" : "inline",
  // A small bounded batch lets the minute cron keep up with captures without
  // turning a serverless invocation into an unbounded model-processing loop.
  workerBatchSize: Math.min(8, Math.max(1, Number(process.env.BRAINIA_WORKER_BATCH_SIZE ?? 3))),
} as const;
