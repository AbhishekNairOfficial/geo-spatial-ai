import type { DatasetSummary, GeoFeature, Kpi } from "../llm/types";

export interface DataFilters {
  year?: number;
  yearRange?: [number, number];
  countries?: string[];
  metric?: string;
  limit?: number;
}

export interface DataQueryResult {
  features: GeoFeature[];
  kpis: Kpi[];
}

export interface DataProvider {
  readonly id: string;
  getSummary(): Promise<DatasetSummary>;
  query(filters: DataFilters): Promise<DataQueryResult>;
}
