import OpenAI from "openai";
import { AssistantPayloadSchema, assistantResponseJsonSchema } from "../schema";
import { LlmError, type LlmProvider } from "../provider";
import type { AssistantPayload, ChatInput } from "../types";

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai" as const;
  private client: OpenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new LlmError(
        "OPENAI_API_KEY is not set. Add it to .env.local or your Vercel project environment."
      );
    }
    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  async chat(input: ChatInput): Promise<AssistantPayload> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: input.systemPrompt },
        ...input.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      response_format: {
        type: "json_schema",
        json_schema: assistantResponseJsonSchema,
      },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new LlmError("OpenAI returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new LlmError("OpenAI response was not valid JSON.", err);
    }

    const result = AssistantPayloadSchema.safeParse(parsed);
    if (!result.success) {
      throw new LlmError(
        `OpenAI response failed schema validation: ${result.error.message}`,
        result.error
      );
    }
    return result.data as AssistantPayload;
  }
}
