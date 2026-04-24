import AppHeader from "@/components/layout/AppHeader";
import ChatPanel from "@/components/chat/ChatPanel";
import KpiPanel from "@/components/insights/KpiPanel";
import MapCanvasMount from "@/components/map/MapCanvasMount";

export default function HomePage() {
  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[color:var(--color-background)]">
      <MapCanvasMount />

      <div className="pointer-events-none absolute inset-0 flex flex-col p-4">
        <AppHeader />

        <div className="mt-4 flex min-h-0 flex-1 items-stretch justify-between gap-4">
          <ChatPanel />
          <div className="flex-1" aria-hidden />
          <KpiPanel />
        </div>
      </div>
    </main>
  );
}
