"use client";

import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { useChatStore } from "@/lib/state/useChatStore";

export default function ChatInput() {
  const [value, setValue] = useState("");
  const send = useChatStore((s) => s.send);
  const isSending = useChatStore((s) => s.isSending);

  const submit = async () => {
    if (!value.trim() || isSending) return;
    const pending = value;
    setValue("");
    await send(pending);
  };

  return (
    <form
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter Site ID or Scenario..."
        className="h-12 w-full rounded-2xl border border-[color:var(--color-border)] bg-white px-4 pr-14 text-sm text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-primary)]"
        disabled={isSending}
      />
      <button
        type="submit"
        disabled={isSending || !value.trim()}
        aria-label="Send message"
        className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center overflow-hidden rounded-full border border-white bg-gradient-to-br from-[#8b98f5] via-[#4352e5] to-[#2a37b3] shadow-[0_0_4px_rgba(51,51,51,0.12)] transition disabled:opacity-50"
      >
        <ArrowUp className="size-5 text-white" />
      </button>
    </form>
  );
}
