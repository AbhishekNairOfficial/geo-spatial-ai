import { bbox } from "@turf/bbox";
import type { Feature, FeatureCollection } from "geojson";
import type { DataProvider } from "@/lib/data";
import {
  extractZipCodesFromText,
  MAX_HIGHLIGHT_ZIP_CODES,
} from "@/lib/geo/extractZipCodesFromText";
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

function mergeHighlightZipCodes(
  modelZips: string[] | undefined,
  message: string | undefined
): string[] {
  const fromModel = modelZips ?? [];
  const fromMsg = extractZipCodesFromText(message ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const z of [...fromModel, ...fromMsg]) {
    if (seen.has(z)) continue;
    seen.add(z);
    out.push(z);
    if (out.length >= MAX_HIGHLIGHT_ZIP_CODES) break;
  }
  return out;
}

function appendMissingBoundaryNote(message: string): string {
  const hint =
    " Real ZCTA boundary shapes are provided by the server; none were found in the database for this selection.";
  if (message.includes("none were found in the database")) return message;
  const base = message.trim();
  const gap = base.length === 0 ? "" : base.endsWith(".") ? " " : ". ";
  return `${base}${gap}${hint.trim()}`;
}

export type ZipDataEnrichmentOptions = {
  /** Latest user message; 5-digit ZIPs are merged into `highlightZipCodes` for server lookup. */
  latestUserMessage?: string;
};

/**
 * Fills `geoFeatures` (and optional KPIs) from ingested ZCTA + IRS data when
 * `highlightTopN` or `highlightZipCodes` (including ZIPs parsed from the user
 * message) request a map highlight.
 */
export async function applyZipDataEnrichment(
  summary: DatasetSummary,
  data: DataProvider,
  payload: AssistantPayload,
  options?: ZipDataEnrichmentOptions
): Promise<AssistantPayload> {
  if (summary.geography !== "us_zip") return payload;

  const mergedZips = mergeHighlightZipCodes(
    payload.highlightZipCodes,
    options?.latestUserMessage
  );
  const hasTopN = (payload.highlightTopN ?? 0) > 0;
  const hasZips = mergedZips.length > 0;
  if (!hasTopN && !hasZips) return payload;

  const usStateFips = normalizeUsStateToFips(payload.highlightUsState);

  const defaultMetric = summary.primaryMetric
    ? String(summary.primaryMetric)
    : undefined;
  const metricRaw = payload.highlightMetric?.trim() ?? "";
  const metric = metricRaw.length > 0 ? metricRaw : defaultMetric;

  const cleared: AssistantPayload = {
    ...payload,
    highlightZipCodes: mergedZips,
    geoFeatures: [],
    mapCommand: undefined,
  };

  try {
    if (hasZips) {
      const { features, kpis } = await data.query({
        zips: cleared.highlightZipCodes,
        metric: metric || undefined,
        usStateFips,
      });
      if (features.length > 0) {
        return {
          ...cleared,
          geoFeatures: features,
          kpis,
          mapCommand: mapCommandForFeatures(features),
        };
      }
      return {
        ...cleared,
        message: appendMissingBoundaryNote(cleared.message),
      };
    }

    const n = Math.min(10_000, Math.max(1, payload.highlightTopN ?? 0));
    const { features, kpis } = await data.query({
      topN: n,
      metric: metric || undefined,
      usStateFips,
    });
    if (features.length > 0) {
      return {
        ...cleared,
        geoFeatures: features,
        kpis,
        mapCommand: mapCommandForFeatures(features),
      };
    }
    return {
      ...cleared,
      message: appendMissingBoundaryNote(cleared.message),
    };
  } catch (err) {
    console.warn(
      "[enrichZipPayload] data query failed; dropped LLM map geometry:",
      err
    );
    return {
      ...cleared,
      message: appendMissingBoundaryNote(cleared.message),
    };
  }
}
