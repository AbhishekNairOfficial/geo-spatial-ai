import { NextResponse } from "next/server";
import { z } from "zod";
import { LlmError } from "@/lib/llm";
import { getDataProvider } from "@/lib/data";
import { orchestrateChat } from "@/lib/agent/orchestrator";

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
    const payload = await orchestrateChat({
      messages: parsed.data.messages,
      summary,
      dataProvider: data,
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
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
