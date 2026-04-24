import { AzureOpenAI } from "openai";
import { AssistantPayloadSchema, assistantResponseJsonSchema } from "../schema";
import { LlmError, type LlmProvider } from "../provider";
import type { AssistantPayload, ChatInput } from "../types";

export class AzureOpenAIProvider implements LlmProvider {
  readonly name = "azure-openai" as const;
  private client: AzureOpenAI;
  private deployment: string;

  constructor() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiVersion =
      process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview";

    if (!endpoint || !apiKey || !deployment) {
      throw new LlmError(
        "Azure OpenAI requires AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT."
      );
    }

    this.client = new AzureOpenAI({
      endpoint,
      apiKey,
      apiVersion,
      deployment,
    });
    this.deployment = deployment;
  }

  async chat(input: ChatInput): Promise<AssistantPayload> {
    const completion = await this.client.chat.completions.create({
      model: this.deployment,
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
      throw new LlmError("Azure OpenAI returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new LlmError("Azure OpenAI response was not valid JSON.", err);
    }

    const result = AssistantPayloadSchema.safeParse(parsed);
    if (!result.success) {
      throw new LlmError(
        `Azure OpenAI response failed schema validation: ${result.error.message}`,
        result.error
      );
    }
    return result.data as AssistantPayload;
  }
}
