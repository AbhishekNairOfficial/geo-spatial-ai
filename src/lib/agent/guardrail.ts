import OpenAI from "openai";
import { z } from "zod";

const GuardrailResultSchema = z.object({
  inScope: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type GuardrailResult = z.infer<typeof GuardrailResultSchema>;

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

const responseSchema = {
  name: "relevance_guardrail",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      inScope: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
    },
    required: ["inScope", "confidence", "reason"],
  },
} as const;

const FALLBACK_CONFIDENCE = 0.5;

// Singleton — constructed once, reused across calls
const client = getClient();

function failOpen(reason: string): GuardrailResult {
  return { inScope: false, confidence: FALLBACK_CONFIDENCE, reason };
}

export async function classifyPromptRelevance(
  message: string
): Promise<GuardrailResult> {
  if (!client) {
    return failOpen("OPENAI_API_KEY is missing; skipping relevance guardrail.");
  }

  const normalizedMessage = message.trim();
  const model =
    process.env.GUARDRAIL_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  let raw: string | null | undefined;
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "Classify whether the user request is in scope for a US ZIP/geospatial tax-data assistant. " +
            "In scope: ZIP-level tax data, geospatial boundary requests, tax KPI comparisons, map-focused analytics, " +
            "ranking or sorting tax zones by any metric (e.g. 'top 3 in Washington', 'most expensive zone'), " +
            "filtering or comparing zones by region (e.g. 'east coast', 'nationwide', 'a specific state'). " +
            "Out of scope: unrelated topics, general chit-chat without tax/geospatial intent, legal/financial advice requests." +
            "Examples of IN scope: 'What are the top 3 ZIP codes in Washington by tax rate?', " +
            "'Show me the highest burden zones on the east coast', 'Which zone is most expensive nationwide?'. " +
            "Examples of OUT of scope: 'What is the capital of France?', 'Write me a contract', 'Tell me a joke'.",
        },
        { role: "user", content: normalizedMessage },
      ],
      response_format: { type: "json_schema", json_schema: responseSchema },
      temperature: 0,
    });
    raw = completion.choices[0]?.message?.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failOpen(`Guardrail API call failed (${message}); defaulting to in-scope.`);
  }

  if (!raw) {
    return failOpen("Guardrail returned empty output; defaulting to in-scope.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return failOpen("Guardrail output was not valid JSON; defaulting to in-scope.");
  }

  const parsed = GuardrailResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return failOpen("Guardrail output failed validation; defaulting to in-scope.");
  }

  return parsed.data;
}
