"use client";

import { Lightbulb, X } from "lucide-react";
import { useKpiStore } from "@/lib/state/useKpiStore";
import KpiCard from "./KpiCard";

export default function KpiPanel() {
  const kpis = useKpiStore((s) => s.kpis);
  const setKpis = useKpiStore((s) => s.setKpis);

  if (kpis.length === 0) {
    return null;
  }

  return (
    <section className="geo-glass pointer-events-auto flex h-full w-[305px] flex-col gap-4 overflow-hidden rounded-3xl p-1">
      <header className="flex items-center justify-between rounded-xl bg-gradient-to-b from-white/30 to-transparent px-2 py-2 sm:px-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-5 text-[#f59e0b]" />
          <h2 className="font-[var(--font-display)] text-lg font-bold text-[color:var(--color-foreground)] [text-shadow:0_0_4px_rgba(255,255,255,0.25)]">
            Key Insights
          </h2>
        </div>
        <button
          type="button"
          aria-label="Clear insights"
          onClick={() => setKpis([])}
          className="grid size-6 place-items-center rounded-full text-[color:var(--color-muted)] transition hover:bg-white/40"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="geo-scrollbar absolute inset-0 flex flex-col gap-3 overflow-y-auto pr-1">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-gradient-to-t from-[color:var(--color-background)] to-transparent" />
      </div>
    </section>
  );
}
