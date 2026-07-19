import { generateNaturalLanguageSummary } from "../storage/deepseek.js";

const response = await generateNaturalLanguageSummary({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  systemPrompt: "Return strict JSON only: {\"ok\":true}.",
  userPrompt: "Probe the semantic model connection.",
});

console.log(response ?? "null");
