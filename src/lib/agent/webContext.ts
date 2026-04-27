import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

/**
 * Optional web context used by the orchestrator before final payload generation.
 * Failures are non-fatal so chat can continue with dataset-only answers.
 */
export async function getWebSearchContext(
  question: string
): Promise<string | null> {
  const client = getClient();
  if (!client || !question.trim()) return null;

  const model = process.env.OPENAI_WEB_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const response = await client.responses.create({
      model,
      tools: [{ type: "web_search_preview" }],
      input: [
        {
          role: "system",
          content:
            "Summarize only the most relevant web findings for this question in 3-5 concise bullets. " +
            "Focus on tax/geospatial context and include source names inline when possible.",
        },
        {
          role: "user",
          content: question.trim(),
        },
      ],
    });

    const outputText = response.output_text?.trim();
    return outputText || null;
  } catch (err) {
    console.warn("[webContext] web search unavailable:", err);
    return null;
  }
}
