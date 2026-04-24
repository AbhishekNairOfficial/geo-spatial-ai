import type { DatasetSummary, GeoFeature, Kpi } from "../llm/types";

export interface DataFilters {
  year?: number;
  yearRange?: [number, number];
  countries?: string[];
  /** US 5-digit ZCTA / ZIP codes (for `us_zip` Kaggle builds). */
  zips?: string[];
  metric?: string;
  limit?: number;
  /** Return the top-N ZIPs by `metric` (latest or mean from rollups). */
  topN?: number;
  /**
   * When set, only ZIPs whose rollup `state` matches this 2-digit FIPS (e.g. `"53"` for WA)
   * are considered for `topN` and for metric values. Ignored for explicit `zips` lists.
   */
  usStateFips?: string;
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
