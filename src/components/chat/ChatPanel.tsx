"use client";

import { Plus, Sparkles } from "lucide-react";
import { useChatStore } from "@/lib/state/useChatStore";
import ChatEmptyState from "./ChatEmptyState";
import ChatInput from "./ChatInput";
import ChatMessageList from "./ChatMessageList";

export default function ChatPanel() {
  const hasMessages = useChatStore((s) => s.messages.length > 0);
  const reset = useChatStore((s) => s.reset);

  return (
    <section className="pointer-events-auto flex h-full w-[353px] flex-col overflow-hidden rounded-3xl bg-white px-4 pb-4 pt-6 shadow-[var(--shadow-soft)]">
      <header className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="grid size-6 place-items-center rounded-md bg-[color:var(--color-accent)]">
            <Sparkles className="size-4 text-[color:var(--color-primary)]" />
          </div>
          <h2 className="font-[var(--font-display)] text-base font-semibold text-[color:var(--color-foreground)]">
            Intelligent Assistant
          </h2>
        </div>
        <button
          type="button"
          onClick={reset}
          aria-label="New conversation"
          className="grid size-8 place-items-center rounded-xl border border-[color:var(--color-border)] text-[color:var(--color-foreground)] transition hover:bg-[color:var(--color-background)]"
        >
          <Plus className="size-4" />
        </button>
      </header>

      <div className="my-4 flex-1 overflow-hidden">
        {hasMessages ? <ChatMessageList /> : <ChatEmptyState />}
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute -top-8 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent" />
        <ChatInput />
      </div>
    </section>
  );
}
