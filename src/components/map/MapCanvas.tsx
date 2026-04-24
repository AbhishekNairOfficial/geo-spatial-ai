"use client";

import { useEffect, useMemo, useRef } from "react";
import { DeckGL } from "@deck.gl/react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import MapGL, { type MapRef } from "react-map-gl/mapbox";
import type { Feature, FeatureCollection } from "geojson";
import { useMapStore } from "@/lib/state/useMapStore";
import type { GeoFeature } from "@/lib/llm/types";
import { divergingColor, indigoFallbackColor } from "./color-scale";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const MAP_STYLE = "mapbox://styles/mapbox/light-v11";

export default function MapCanvas() {
  const viewState = useMapStore((s) => s.viewState);
  const setViewState = useMapStore((s) => s.setViewState);
  const features = useMapStore((s) => s.features);
  const mapCommand = useMapStore((s) => s.mapCommand);
  const mapRef = useRef<MapRef>(null);

  useEffect(() => {
    if (!mapCommand) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (mapCommand.bounds) {
      const [w, s, e, n] = mapCommand.bounds;
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 120, duration: 1200 }
      );
    } else if (mapCommand.flyTo) {
      map.flyTo({
        center: [mapCommand.flyTo.longitude, mapCommand.flyTo.latitude],
        zoom: mapCommand.flyTo.zoom ?? 4,
        duration: 1200,
      });
    }
  }, [mapCommand]);

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
      out.push(
        new GeoJsonLayer({
          id: "llm-polygons",
          data: polygonCollection,
          filled: true,
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: 1,
          getLineColor: [255, 255, 255, 200],
          getFillColor: (feature: unknown) => {
            const f = feature as Feature;
            const value = (f.properties as { value?: number } | null)?.value;
            if (typeof value !== "number") return indigoFallbackColor(180);
            return divergingColor(value, valueRange[0], valueRange[1], 210);
          },
          pickable: true,
          autoHighlight: true,
          highlightColor: [67, 82, 229, 80],
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
  }, [polygonCollection, points, valueRange]);

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
        initialViewState={viewState}
        controller
        layers={layers}
        onViewStateChange={(evt) => {
          const vs = evt.viewState as Partial<typeof viewState>;
          setViewState(vs);
        }}
      >
        <MapGL
          ref={mapRef}
          reuseMaps
          mapStyle={MAP_STYLE}
          mapboxAccessToken={MAPBOX_TOKEN}
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
