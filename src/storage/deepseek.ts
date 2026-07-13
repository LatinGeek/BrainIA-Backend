type DeepSeekChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function generateNaturalLanguageSummary(input: {
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  if (!input.apiKey) {
    return null;
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model ?? "deepseek-v4-flash",
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ] satisfies DeepSeekChatMessage[],
      thinking: { type: "disabled" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek request failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  return json.choices?.[0]?.message?.content ?? null;
}
