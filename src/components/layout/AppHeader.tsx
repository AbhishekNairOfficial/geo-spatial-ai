"use client";

import { Calendar, ChevronDown, Leaf, Settings } from "lucide-react";

export default function AppHeader() {
  return (
    <header className="pointer-events-auto flex w-full items-center gap-3">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-[var(--shadow-card)]">
        <Leaf className="size-8 text-[#61c080]" aria-hidden />
      </div>

      <div className="flex h-16 flex-1 items-center justify-between rounded-2xl bg-white px-4 py-2 shadow-[var(--shadow-card)]">
        <p className="font-[var(--font-display)] text-xl font-semibold text-[color:var(--color-foreground)]">
          Geo Spatial AI
        </p>
        <div className="flex items-center gap-3">
          <PillSelect label="Dataset" />
          <PillSelect label="2000 – 2015" icon="calendar" />
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-[var(--shadow-card)]">
        <button
          type="button"
          aria-label="Settings"
          className="grid size-10 place-items-center rounded-2xl border border-[#d6d6d6] text-[color:var(--color-foreground)] transition hover:bg-[color:var(--color-background)]"
        >
          <Settings className="size-5" />
        </button>
        <div className="grid size-10 place-items-center rounded-full bg-[color:var(--color-accent)] font-[var(--font-display)] text-lg font-semibold text-[color:var(--color-foreground)]">
          S
        </div>
      </div>
    </header>
  );
}

function PillSelect({
  label,
  icon = "chevron",
}: {
  label: string;
  icon?: "chevron" | "calendar";
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-[180px] items-center justify-between rounded-xl border border-[color:var(--color-stroke-grey)] bg-white px-4 font-[var(--font-display)] text-sm font-semibold text-[color:var(--color-foreground)] transition hover:bg-[color:var(--color-background)]"
    >
      <span>{label}</span>
      {icon === "calendar" ? (
        <Calendar className="size-5" />
      ) : (
        <ChevronDown className="size-5" />
      )}
    </button>
  );
}
