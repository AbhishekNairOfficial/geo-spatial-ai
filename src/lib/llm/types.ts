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
}

export interface DatasetSummary {
  datasetId: string;
  description: string;
  rowCount: number;
  yearRange?: [number, number];
  columns: Array<{ name: string; type: "number" | "string"; example?: unknown }>;
  rollups?: unknown;
}

export interface ChatInput {
  messages: ChatMessage[];
  systemPrompt: string;
  responseSchema: Record<string, unknown>;
}
