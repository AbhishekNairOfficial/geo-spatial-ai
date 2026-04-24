import type { Geometry } from "geojson";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type TrendDirection = "up" | "down" | "flat";

export interface Kpi {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  delta?: number;
  direction?: TrendDirection;
  timeframe?: string;
}

export type GeoFeatureKind = "point" | "polygon" | "line";

export interface GeoFeature {
  id: string;
  kind: GeoFeatureKind;
  geometry: Geometry;
  label?: string;
  color?: string;
  value?: number;
  /**
   * US ZIP / country metadata from the model. `iso3` is empty for US ZCTA; `zip` is
   * a 5-digit string when the feature is ZIP-based.
   */
  properties?: Record<string, unknown>;
}

export interface MapCommand {
  flyTo?: { longitude: number; latitude: number; zoom?: number };
  bounds?: [number, number, number, number];
}

export interface AssistantPayload {
  message: string;
  geoFeatures: GeoFeature[];
  kpis: Kpi[];
  mapCommand?: MapCommand;
  /**
   * When the dataset is US-ZIP, set &gt; 0 to have the server select the top N ZIPs
   * by `highlightMetric` (or primary metric) and fill `geoFeatures` from ingested
   * ZCTA polygons. Zero means “do not use top-N auto-fill”.
   */
  highlightTopN: number;
  /**
   * Explicit 5-digit ZIPs to highlight (e.g. rule-based filters). The server
   * resolves polygons from the Kaggle `features` artifact.
   */
  highlightZipCodes: string[];
  /**
   * IRS / dataset column to rank or color by, e.g. N1, A00100. Empty to use
   * primary metric.
   */
  highlightMetric: string;
  /**
   * When set (e.g. `WA` or `53`), **top-N** ranking is limited to that state’s ZIPs.
   * Use `""` when the question is US-wide. Does not apply when using `highlightZipCodes` only.
   */
  highlightUsState: string;
}

export interface DatasetSummary {
  datasetId: string;
  description: string;
  rowCount: number;
  /** When `us_zip`, the app uses US-only bounds and ZCTA / IRS semantics. */
  geography?: "world" | "us_zip" | "static";
  yearRange?: [number, number];
  columns: Array<{ name: string; type: "number" | "string"; example?: unknown }>;
  primaryMetric?: string | null;
  rollups?: unknown;
}

export interface ChatInput {
  messages: ChatMessage[];
  systemPrompt: string;
  responseSchema: Record<string, unknown>;
}
