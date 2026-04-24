import { create } from "zustand";
import type { AssistantPayload } from "@/lib/llm/types";
import { useMapStore } from "./useMapStore";
import { useKpiStore } from "./useKpiStore";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type ChatState = {
  messages: ChatMessage[];
  isSending: boolean;
  error: string | null;
  send: (userInput: string) => Promise<void>;
  reset: () => void;
};

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isSending: false,
  error: null,
  reset: () => {
    set({ messages: [], error: null });
    useMapStore.getState().setFeatures([]);
    useMapStore.getState().setMapCommand(undefined);
    useKpiStore.getState().setKpis([]);
  },
  send: async (userInput: string) => {
    const trimmed = userInput.trim();
    if (!trimmed || get().isSending) return;

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      isSending: true,
      error: null,
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...get().messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `Request failed: ${res.status}`);
      }

      const payload = (await res.json()) as AssistantPayload;

      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: payload.message || "(no response)",
        createdAt: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isSending: false,
      }));

      useMapStore.getState().setFeatures(payload.geoFeatures);
      useMapStore.getState().setMapCommand(payload.mapCommand);
      useKpiStore.getState().setKpis(payload.kpis);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
        isSending: false,
      });
    }
  },
}));
