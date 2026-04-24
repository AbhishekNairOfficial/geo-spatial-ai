"use client";

import dynamic from "next/dynamic";

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-[color:var(--color-background)] text-sm text-[color:var(--color-muted)]">
      Loading map…
    </div>
  ),
});

export default function MapCanvasMount() {
  return <MapCanvas />;
}
