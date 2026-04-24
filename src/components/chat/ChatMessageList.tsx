"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { useChatStore } from "@/lib/state/useChatStore";
import { cn } from "@/lib/utils";

export default function ChatMessageList() {
  const messages = useChatStore((s) => s.messages);
  const isSending = useChatStore((s) => s.isSending);
  const error = useChatStore((s) => s.error);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  return (
    <div
      ref={scrollRef}
      className="geo-scrollbar flex w-full flex-1 flex-col gap-3 overflow-y-auto px-1 py-2"
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "max-w-full rounded-2xl px-3 py-2 text-sm leading-snug",
            m.role === "user"
              ? "self-end bg-[color:var(--color-primary)] text-white"
              : "self-start bg-[color:var(--color-background)] text-[color:var(--color-foreground)]"
          )}
        >
          {m.role === "assistant" ? (
            <div className="prose prose-sm prose-neutral max-w-none">
              <ReactMarkdown>{m.content}</ReactMarkdown>
            </div>
          ) : (
            m.content
          )}
        </div>
      ))}
      {isSending && (
        <div className="self-start rounded-2xl bg-[color:var(--color-background)] px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--color-primary)]" />
            <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--color-primary)] [animation-delay:120ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--color-primary)] [animation-delay:240ms]" />
          </span>
        </div>
      )}
      {error && (
        <div className="self-start rounded-2xl bg-[color:var(--color-negative)]/10 px-3 py-2 text-sm text-[color:var(--color-negative)]">
          {error}
        </div>
      )}
    </div>
  );
}
