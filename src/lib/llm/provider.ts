import type { AssistantPayload, ChatInput } from "./types";

export interface LlmProvider {
  readonly name: "openai" | "azure-openai";
  chat(input: ChatInput): Promise<AssistantPayload>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "LlmError";
  }
}
