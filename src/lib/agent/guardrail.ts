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

export async function classifyPromptRelevance(
  message: string
): Promise<GuardrailResult> {
  const client = getClient();
  if (!client) {
    return {
      inScope: true,
      confidence: 0.5,
      reason: "OPENAI_API_KEY is missing; skipping relevance guardrail.",
    };
  }

  const model = process.env.GUARDRAIL_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Classify whether the user request is in scope for a US ZIP/geospatial tax-data assistant. " +
          "In scope: ZIP-level tax data, geospatial boundary requests, tax KPI comparisons, map-focused analytics. " +
          "Out of scope: unrelated topics, general chit-chat without tax/geospatial intent, legal/financial advice requests.",
      },
      { role: "user", content: message.trim() },
    ],
    response_format: {
      type: "json_schema",
      json_schema: responseSchema,
    },
    temperature: 0,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return {
      inScope: true,
      confidence: 0.5,
      reason: "Guardrail returned empty output; defaulting to in-scope.",
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return {
      inScope: true,
      confidence: 0.5,
      reason: "Guardrail output was not valid JSON; defaulting to in-scope.",
    };
  }

  const parsed = GuardrailResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      inScope: true,
      confidence: 0.5,
      reason: "Guardrail output failed validation; defaulting to in-scope.",
    };
  }
  return parsed.data;
}
