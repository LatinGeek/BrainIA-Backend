export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
} as const;
