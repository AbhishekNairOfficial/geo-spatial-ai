import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSystemPrompt, getLlm, LlmError } from "@/lib/llm";
import { ensureAssistantMessage } from "@/lib/llm/ensureAssistantMessage";
import { applyZipDataEnrichment } from "@/lib/llm/enrichZipPayload";
import { assistantResponseJsonSchema } from "@/lib/llm/schema";
import { getDataProvider } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const data = await getDataProvider();
    const summary = await data.getSummary();

    const llm = getLlm();
    let payload = await llm.chat({
      messages: parsed.data.messages,
      systemPrompt: buildSystemPrompt(summary),
      responseSchema: assistantResponseJsonSchema.schema as Record<
        string,
        unknown
      >,
    });

    payload = await applyZipDataEnrichment(summary, data, payload);
    payload = ensureAssistantMessage(payload);

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/chat] error:", err);
    const message =
      err instanceof LlmError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
