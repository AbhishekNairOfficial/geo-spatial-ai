import { performance } from "node:perf_hooks";
import { buildSystemPrompt, getLlm } from "@/lib/llm";
import { ensureAssistantMessage } from "@/lib/llm/ensureAssistantMessage";
import { applyZipDataEnrichment } from "@/lib/llm/enrichZipPayload";
import { assistantResponseJsonSchema } from "@/lib/llm/schema";
import type { AssistantPayload, ChatMessage, DatasetSummary } from "@/lib/llm/types";
import type { DataProvider } from "@/lib/data";
import { classifyPromptRelevance } from "./guardrail";
import { getWebSearchContext } from "./webContext";
import { getStructuredDataContext } from "./tools";

const RELEVANCE_CONFIDENCE_THRESHOLD = 0.65;

function buildOutOfScopePayload(reason: string): AssistantPayload {
  return {
    message:
      "I can help with US ZIP-level tax and geospatial questions. " +
      `This request looks out of scope: ${reason}`,
    geoFeatures: [],
    kpis: [],
    mapCommand: undefined,
    highlightTopN: 0,
    highlightZipCodes: [],
    highlightMetric: "",
    highlightUsState: "",
  };
}

function latestUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return messages[i].content;
    }
  }
  return "";
}

export async function orchestrateChat(args: {
  messages: ChatMessage[];
  summary: DatasetSummary;
  dataProvider: DataProvider;
  requestId?: string;
}): Promise<AssistantPayload> {
  const { messages, summary, dataProvider, requestId } = args;
  const prompt = latestUserMessage(messages);
  const t0 = performance.now();

  const relevance = await classifyPromptRelevance(prompt);
  if (!relevance.inScope && relevance.confidence >= RELEVANCE_CONFIDENCE_THRESHOLD) {
    console.info("[orchestrator] out_of_scope", {
      requestId,
      confidence: relevance.confidence,
      reason: relevance.reason,
      ms: Math.round(performance.now() - t0),
    });
    return buildOutOfScopePayload(relevance.reason);
  }

  const webContext = await getWebSearchContext(prompt);
  const dataContext = await getStructuredDataContext({
    message: prompt,
    summary,
    dataProvider,
  });
  const systemPromptBase = buildSystemPrompt(summary);
  const promptParts = [systemPromptBase];
  if (dataContext) {
    promptParts.push(
      `\nStructured data context from tool queries (trusted):\n${dataContext}`
    );
  }
  if (webContext) {
    promptParts.push(
      `\nOptional external context (verify against dataset; prefer dataset for numeric facts):\n${webContext}`
    );
  }
  const systemPrompt = promptParts.join("\n");

  const llm = getLlm();
  let payload = await llm.chat({
    messages,
    systemPrompt,
    responseSchema: assistantResponseJsonSchema.schema as Record<string, unknown>,
  });

  payload = await applyZipDataEnrichment(summary, dataProvider, payload);
  payload = ensureAssistantMessage(payload);

  console.info("[orchestrator] completed", {
    requestId,
    inScope: relevance.inScope,
    confidence: relevance.confidence,
    hadWebContext: Boolean(webContext),
    hadDataContext: Boolean(dataContext),
    ms: Math.round(performance.now() - t0),
  });

  return payload;
}
