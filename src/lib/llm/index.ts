import { OpenAIProvider } from "./providers/openai";
import { AzureOpenAIProvider } from "./providers/azure-openai";
import type { LlmProvider } from "./provider";

let cached: LlmProvider | null = null;

export function getLlm(): LlmProvider {
  if (cached) return cached;
  const provider = process.env.LLM_PROVIDER ?? "openai";
  cached =
    provider === "azure-openai"
      ? new AzureOpenAIProvider()
      : new OpenAIProvider();
  return cached;
}

export { buildSystemPrompt } from "./prompt";
export type * from "./types";
export { LlmError } from "./provider";
