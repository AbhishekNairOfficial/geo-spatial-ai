"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { DeckGL } from "@deck.gl/react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { FlyToInterpolator } from "@deck.gl/core";
import MapGL from "react-map-gl/mapbox";
import { fitBounds } from "@math.gl/web-mercator";
import type { LngLatBoundsLike } from "mapbox-gl";
import type { Feature, FeatureCollection } from "geojson";
import { useMapStore } from "@/lib/state/useMapStore";
import type { GeoFeature } from "@/lib/llm/types";
import { fipsToUsps } from "@/lib/geo/usStateFips";
import { divergingColor, indigoFallbackColor } from "./color-scale";
import type { MapScope } from "./mapScope";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Resets deck.gl’s default dark tooltip host (see `TooltipWidget` inline styles). */
const MAP_TOOLTIP_HOST = {
  className: "deck-tooltip",
  style: {
    backgroundColor: "transparent",
    padding: "0",
    border: "0",
    boxShadow: "none",
    color: "inherit",
    maxWidth: "min(22rem, calc(100vw - 1.5rem))",
  } as const,
} as const;

function formatFeatureTooltip(f: Feature) {
  const p = (f.properties ?? {}) as {
    id?: string;
    label?: string;
    value?: number;
    zip?: string;
    state?: string;
    name?: string;
    note?: string;
  };
  const zip = (p.zip || String(p.id || "")).trim() || "—";
  const rawSt = p.state?.trim() ?? "";
  const stateLine =
    rawSt && /^\d{1,2}$/.test(rawSt)
      ? `${fipsToUsps(rawSt) ?? "—"} (FIPS ${rawSt.padStart(2, "0")})`
      : rawSt || "—";
  const title = p.label || p.name || (zip !== "—" ? `ZIP ${zip}` : "Selected area");
  const metricName = p.note?.trim() || "Value";
  const val =
    typeof p.value === "number" && Number.isFinite(p.value)
      ? p.value.toLocaleString()
      : "—";
  return {
    ...MAP_TOOLTIP_HOST,
    html: `<div class="map-tooltip-geo">
  <p class="map-tooltip-geo__title">${escapeHtml(title)}</p>
  <dl class="map-tooltip-geo__rows">
    <dt class="map-tooltip-geo__k">ZIP</dt>
    <dd class="map-tooltip-geo__v">${escapeHtml(zip)}</dd>
    <dt class="map-tooltip-geo__k">State</dt>
    <dd class="map-tooltip-geo__v">${escapeHtml(stateLine)}</dd>
    <dt class="map-tooltip-geo__k">${escapeHtml(metricName)}</dt>
    <dd class="map-tooltip-geo__v">${escapeHtml(val)}</dd>
  </dl>
</div>`,
  };
}

function formatPointTooltip(d: GeoFeature) {
  const name = d.label || d.properties?.name || d.id;
  const val =
    typeof d.value === "number" && Number.isFinite(d.value)
      ? d.value.toLocaleString()
      : "—";
  return {
    ...MAP_TOOLTIP_HOST,
    html: `<div class="map-tooltip-geo">
  <p class="map-tooltip-geo__title">${escapeHtml(String(name))}</p>
  <dl class="map-tooltip-geo__rows">
    <dt class="map-tooltip-geo__k">Value</dt>
    <dd class="map-tooltip-geo__v">${escapeHtml(val)}</dd>
  </dl>
</div>`,
  };
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const MAP_STYLE = "mapbox://styles/mapbox/light-v11";

/** Continental US (lower 48 + small buffer). */
const US_W = -128;
const US_S = 22;
const US_E = -65;
const US_N = 50;
const US_MAX_BOUNDS: LngLatBoundsLike = [
  [US_W, US_S],
  [US_E, US_N],
];

const US_DEFAULT_VIEW = {
  longitude: -98,
  latitude: 39.5,
  zoom: 3.45,
  pitch: 0,
  bearing: 0,
} as const;

export default function MapCanvas({ mapScope = "global" }: { mapScope?: MapScope }) {
  const viewState = useMapStore((s) => s.viewState);
  const setViewState = useMapStore((s) => s.setViewState);
  const setMapCommand = useMapStore((s) => s.setMapCommand);
  const features = useMapStore((s) => s.features);
  const mapCommand = useMapStore((s) => s.mapCommand);
  const scopeApplied = useRef(false);

  useLayoutEffect(() => {
    if (mapScope !== "us" || scopeApplied.current) return;
    scopeApplied.current = true;
    setViewState(US_DEFAULT_VIEW);
  }, [mapScope, setViewState]);

  /**
   * DeckGL only uses `initialViewState` on mount; we must drive the camera with
   * controlled `viewState` + transitions. `map.getMap().flyTo()` fights Deck.
   */
  useEffect(() => {
    if (!mapCommand) return;
    const w =
      typeof window !== "undefined" ? window.innerWidth : 1200;
    const h =
      typeof window !== "undefined" ? window.innerHeight : 800;

    let longitude: number;
    let latitude: number;
    let zoom: number;

    if (mapCommand.bounds) {
      let [west, south, east, north] = mapCommand.bounds;
      if (mapScope === "us") {
        west = Math.max(west, US_W);
        south = Math.max(south, US_S);
        east = Math.min(east, US_E);
        north = Math.min(north, US_N);
      }
      const fitted = fitBounds({
        width: w,
        height: h,
        bounds: [
          [west, south],
          [east, north],
        ],
        padding: 120,
        maxZoom: 14,
      });
      longitude = fitted.longitude;
      latitude = fitted.latitude;
      zoom = fitted.zoom;
    } else if (mapCommand.flyTo) {
      ({ longitude, latitude, zoom } = {
        longitude: mapCommand.flyTo.longitude,
        latitude: mapCommand.flyTo.latitude,
        zoom: mapCommand.flyTo.zoom ?? 4,
      });
      if (mapScope === "us") {
        longitude = Math.min(US_E, Math.max(US_W, longitude));
        latitude = Math.min(US_N, Math.max(US_S, latitude));
      }
    } else {
      return;
    }

    setViewState({
      longitude,
      latitude,
      zoom,
      pitch: 0,
      bearing: 0,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator(),
    });
    setMapCommand(undefined);
  }, [mapCommand, mapScope, setViewState, setMapCommand]);

  const { polygonCollection, points } = useMemo(
    () => splitFeatures(features),
    [features]
  );

  const valueRange = useMemo(() => {
    const values = features
      .map((f) => f.value)
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) return [0, 1] as const;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [min - 1, max + 1] as const;
    return [min, max] as const;
  }, [features]);

  const layers = useMemo(() => {
    const out: Layer[] = [];

    if (polygonCollection.features.length > 0) {
      const isUsZip = mapScope === "us";
      out.push(
        new GeoJsonLayer({
          id: "llm-polygons",
          data: polygonCollection,
          filled: true,
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: isUsZip ? 2.5 : 1,
          getLineColor: isUsZip
            ? [55, 48, 163, 255]
            : [255, 255, 255, 200],
          getFillColor: (feature: unknown) => {
            const f = feature as Feature;
            const value = (f.properties as { value?: number } | null)?.value;
            if (typeof value !== "number")
              return indigoFallbackColor(isUsZip ? 200 : 180);
            return divergingColor(
              value,
              valueRange[0],
              valueRange[1],
              isUsZip ? 230 : 210
            );
          },
          pickable: true,
          autoHighlight: true,
          highlightColor: [67, 82, 229, 120],
        })
      );
    }

    if (points.length > 0) {
      out.push(
        new ScatterplotLayer({
          id: "llm-points",
          data: points,
          pickable: true,
          stroked: true,
          filled: true,
          radiusUnits: "pixels",
          getPosition: (d: GeoFeature) => {
            const g = d.geometry;
            if (g.type === "Point") {
              return [g.coordinates[0], g.coordinates[1], 0];
            }
            return [0, 0, 0];
          },
          getRadius: 8,
          getFillColor: (d: GeoFeature) =>
            typeof d.value === "number"
              ? divergingColor(d.value, valueRange[0], valueRange[1], 220)
              : indigoFallbackColor(220),
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 2,
        })
      );
    }

    return out;
  }, [mapScope, polygonCollection, points, valueRange]);

  const getTooltip = useCallback((info: PickingInfo) => {
    if (!info.picked || !info.object) return null;
    const lid = info.layer?.id ?? "";
    if (lid === "llm-polygons" || lid.startsWith("llm-polygons-")) {
      return formatFeatureTooltip(info.object as Feature);
    }
    if (lid === "llm-points" || lid.startsWith("llm-points-")) {
      return formatPointTooltip(info.object as GeoFeature);
    }
    return null;
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="grid h-full w-full place-items-center bg-[color:var(--color-background)] p-8 text-center text-sm text-[color:var(--color-muted)]">
        <div>
          <p className="font-medium">Mapbox token missing</p>
          <p className="mt-1">
            Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env.local</code> to render the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <DeckGL
        viewState={viewState}
        controller
        layers={layers}
        getTooltip={getTooltip}
        getCursor={({ isDragging, isHovering }) =>
          isDragging ? "grabbing" : isHovering ? "pointer" : "grab"
        }
        onViewStateChange={(evt) => {
          const vs = evt.viewState as Record<string, unknown>;
          setViewState({
            longitude: vs.longitude as number,
            latitude: vs.latitude as number,
            zoom: vs.zoom as number,
            pitch: (vs.pitch as number) ?? 0,
            bearing: (vs.bearing as number) ?? 0,
          });
        }}
      >
        <MapGL
          reuseMaps
          mapStyle={MAP_STYLE}
          mapboxAccessToken={MAPBOX_TOKEN}
          maxBounds={mapScope === "us" ? US_MAX_BOUNDS : undefined}
        />
      </DeckGL>
    </div>
  );
}

function splitFeatures(features: GeoFeature[]): {
  polygonCollection: FeatureCollection;
  points: GeoFeature[];
} {
  const polys: Feature[] = [];
  const points: GeoFeature[] = [];
  for (const f of features) {
    if (
      f.kind === "polygon" ||
      f.geometry.type === "Polygon" ||
      f.geometry.type === "MultiPolygon"
    ) {
      polys.push({
        type: "Feature",
        id: f.id,
        geometry: f.geometry,
        properties: {
          id: f.id,
          label: f.label,
          value: f.value,
          ...f.properties,
        },
      });
    } else {
      points.push(f);
    }
  }
  return {
    polygonCollection: { type: "FeatureCollection", features: polys },
    points,
  };
}
