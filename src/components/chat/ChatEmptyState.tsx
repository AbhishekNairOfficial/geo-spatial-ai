import { Sparkles } from "lucide-react";

export default function ChatEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="grid size-10 place-items-center rounded-2xl bg-[color:var(--color-accent)]">
        <Sparkles className="size-5 text-[color:var(--color-primary)]" />
      </div>
      <p className="font-[var(--font-display)] text-sm font-medium text-[color:var(--color-foreground)] opacity-80">
        Let&rsquo;s dive in!
      </p>
      <p className="max-w-[239px] text-[11px] leading-[17px] text-[color:var(--color-muted)] opacity-80">
        Ask a geographic question. I&rsquo;ll highlight relevant regions on the
        map and surface KPIs on the right.
      </p>
    </div>
  );
}
