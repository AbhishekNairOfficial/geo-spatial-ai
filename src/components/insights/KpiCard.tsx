import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Kpi } from "@/lib/llm/types";
import { cn } from "@/lib/utils";

const formatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function formatValue(value: Kpi["value"]): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatter.format(value);
  }
  return String(value);
}

export default function KpiCard({ kpi }: { kpi: Kpi }) {
  const direction = kpi.direction ?? "flat";

  return (
    <article className="flex flex-col gap-3 rounded-3xl bg-white p-5 shadow-[var(--shadow-card)]">
      <header className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-[color:var(--color-muted)]">
          {kpi.label}
        </p>
        {typeof kpi.delta === "number" && Number.isFinite(kpi.delta) && (
          <DeltaBadge delta={kpi.delta} direction={direction} />
        )}
      </header>

      <div className="flex items-baseline gap-1">
        <p className="font-[var(--font-display)] text-3xl font-semibold leading-none text-[color:var(--color-foreground)]">
          {formatValue(kpi.value)}
        </p>
        {kpi.unit && (
          <span className="text-sm font-medium text-[color:var(--color-muted)]">
            {kpi.unit}
          </span>
        )}
      </div>

      {kpi.timeframe && (
        <p className="text-xs text-[color:var(--color-muted)]">
          {kpi.timeframe}
        </p>
      )}
    </article>
  );
}

function DeltaBadge({
  delta,
  direction,
}: {
  delta: number;
  direction: "up" | "down" | "flat";
}) {
  const Icon =
    direction === "down"
      ? ArrowDownRight
      : direction === "flat"
        ? Minus
        : ArrowUpRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        direction === "up" &&
          "border-[color:var(--color-positive-border)] bg-[color:var(--color-positive-border)]/10 text-[color:var(--color-positive)]",
        direction === "down" &&
          "border-[color:var(--color-negative-border)] bg-[color:var(--color-negative-border)]/10 text-[color:var(--color-negative)]",
        direction === "flat" &&
          "border-[color:var(--color-stroke-grey)] bg-[color:var(--color-background)] text-[color:var(--color-muted)]"
      )}
    >
      <Icon className="size-3" />
      {delta > 0 ? "+" : ""}
      {formatter.format(delta)}
    </span>
  );
}
