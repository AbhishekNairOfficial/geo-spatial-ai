"use client";

import Image from "next/image";

export default function AppHeader() {
  return (
    <header className="pointer-events-auto flex w-full items-center gap-3">
      <div className="geo-glass-header flex size-16 shrink-0 items-center justify-center rounded-2xl p-3">
        <Image
          src="/geo-spacial-logo.svg"
          alt=""
          width={32}
          height={32}
          className="size-8"
          unoptimized
          priority
        />
      </div>

      <div className="geo-glass-header flex h-16 min-w-0 flex-1 items-center rounded-2xl px-4">
        <p className="font-[var(--font-display)] text-xl font-semibold text-[color:var(--color-foreground)]">
          Geo Spacial AI
        </p>
      </div>
    </header>
  );
}
