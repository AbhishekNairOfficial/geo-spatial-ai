"use client";

import dynamic from "next/dynamic";
import type { MapScope } from "./mapScope";

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-[color:var(--color-background)] text-sm text-[color:var(--color-muted)]">
      Loading map…
    </div>
  ),
});

export type { MapScope } from "./mapScope";

export default function MapCanvasMount({
  mapScope = "global",
}: {
  mapScope?: MapScope;
}) {
  return <MapCanvas mapScope={mapScope} />;
}
