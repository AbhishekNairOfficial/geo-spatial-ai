import { bbox } from "@turf/bbox";
import type { Feature, FeatureCollection } from "geojson";
import type { DataProvider } from "@/lib/data";
import { normalizeUsStateToFips } from "@/lib/geo/usStateFips";
import type {
  AssistantPayload,
  DatasetSummary,
  GeoFeature,
  MapCommand,
} from "./types";

function mapCommandForFeatures(features: GeoFeature[]): MapCommand {
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: features.map(
      (f): Feature => ({
        type: "Feature",
        properties: {},
        geometry: f.geometry,
      })
    ),
  };
  const b = bbox(fc);
  const [w, s, e, n] = b;
  return {
    bounds: [w, s, e, n],
    flyTo: {
      longitude: (w + e) / 2,
      latitude: (s + n) / 2,
      zoom: 7,
    },
  };
}

/**
 * Fills `geoFeatures` (and optional KPIs) from ingested ZCTA + IRS data when
 * the model set `highlightTopN` or `highlightZipCodes`.
 */
export async function applyZipDataEnrichment(
  summary: DatasetSummary,
  data: DataProvider,
  payload: AssistantPayload
): Promise<AssistantPayload> {
  if (summary.geography !== "us_zip") return payload;
  if (data.id !== "kaggle") return payload;

  const hasTopN = (payload.highlightTopN ?? 0) > 0;
  const hasZips = (payload.highlightZipCodes?.length ?? 0) > 0;
  if (!hasTopN && !hasZips) return payload;

  const usStateFips = normalizeUsStateToFips(payload.highlightUsState);

  const defaultMetric = summary.primaryMetric
    ? String(summary.primaryMetric)
    : undefined;
  const metricRaw = payload.highlightMetric?.trim() ?? "";
  const metric = metricRaw.length > 0 ? metricRaw : defaultMetric;

  try {
    if (hasZips) {
      const { features, kpis } = await data.query({
        zips: payload.highlightZipCodes,
        metric: metric || undefined,
        usStateFips,
      });
      if (features.length > 0) {
        return {
          ...payload,
          geoFeatures: features,
          // Always use server KPIs for enriched ZIP selection (LLM cards often use 0/placeholder).
          kpis,
          mapCommand: mapCommandForFeatures(features),
        };
      }
      return payload;
    }

    const n = Math.min(10_000, Math.max(1, payload.highlightTopN ?? 0));
    const { features, kpis } = await data.query({
      topN: n,
      metric: metric || undefined,
      usStateFips,
    });
    if (features.length > 0) {
      return {
        ...payload,
        geoFeatures: features,
        kpis,
        mapCommand: mapCommandForFeatures(features),
      };
    }
  } catch (err) {
    console.warn("[enrichZipPayload] Kaggle query failed, keeping LLM features:", err);
  }

  return payload;
}
