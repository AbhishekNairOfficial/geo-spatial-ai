import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Geometry } from "geojson";
import type { DataFilters, DataProvider, DataQueryResult } from "../provider";
import type { DatasetSummary, GeoFeature, Kpi } from "../../llm/types";
import { fipsToUsps } from "@/lib/geo/usStateFips";

type MetricEntry = {
  earliest: number | null;
  latest: number | null;
  delta: number | null;
  min: number;
  max: number;
  mean: number;
};

type TaxRow = {
  zip: string;
  state_fips: string | null;
  name: string | null;
  earliest_year: number | null;
  latest_year: number | null;
  metrics: Record<string, MetricEntry> | null;
};

type BoundaryRow = {
  zip: string;
  state_fips: string | null;
  name: string | null;
  geometry_geojson: Geometry | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
};

function normalizeZips(codes: string[] | undefined): string[] {
  if (!codes?.length) return [];
  return codes
    .map((z) => z.replace(/\D/g, "").slice(-5).padStart(5, "0"))
    .filter((z) => z.length === 5);
}

function resolveMetricKey(
  metrics: Record<string, MetricEntry>,
  requested: string
): string | undefined {
  if (!requested?.trim()) return undefined;
  const req = requested.trim();
  if (metrics[req]) return req;
  const lower = req.toLowerCase();
  if (metrics[lower]) return lower;
  for (const k of Object.keys(metrics)) {
    if (k.toLowerCase() === lower) return k;
  }
  return undefined;
}

function metricValue(m: MetricEntry | undefined): number | undefined {
  if (!m) return undefined;
  if (typeof m.latest === "number") return m.latest;
  return typeof m.mean === "number" ? m.mean : undefined;
}

function zipKpisForSelection(
  features: GeoFeature[],
  metricKey: string,
  stateFips: string | undefined,
  stateCount: number | null
): Kpi[] {
  const stLabel = stateFips
    ? `${fipsToUsps(stateFips) ?? "State"} (${stateFips})`
    : "US-wide";
  const out: Kpi[] = [
    {
      id: "zip_highlight_count",
      label: "ZIPs on map (this answer)",
      value: features.length,
      unit: "",
      direction: "flat",
      delta: 0,
      timeframe: stateFips ? `Scope: ${stLabel}` : "Scope: all states",
    },
  ];

  const values = features
    .map((f) => f.value)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length > 0) {
    out.push({
      id: "max_in_view",
      label: `Largest ${metricKey || "metric"} among highlighted ZIPs`,
      value: Math.max(...values),
      unit: "",
      direction: "flat",
      delta: 0,
      timeframe: "",
    });
  }

  if (stateFips && typeof stateCount === "number") {
    out.push({
      id: "state_rollup_count",
      label: `ZCTAs with data in ${stLabel}`,
      value: stateCount,
      unit: "",
      direction: "flat",
      delta: 0,
      timeframe: "Rows available in Supabase",
    });
  }
  return out;
}

async function fetchAllTaxRows(
  client: SupabaseClient,
  year: number,
  stateFips?: string
): Promise<TaxRow[]> {
  const pageSize = 1000;
  const out: TaxRow[] = [];
  let offset = 0;
  // Supabase caps rows per request; page to build top-N reliably.
  for (;;) {
    let q = client
      .from("zip_tax_metrics")
      .select("zip,state_fips,name,earliest_year,latest_year,metrics")
      .eq("latest_year", year)
      .range(offset, offset + pageSize - 1);
    if (stateFips) q = q.eq("state_fips", stateFips);
    const { data, error } = await q;
    if (error) throw new Error(`[supabase] fetch tax rows failed: ${error.message}`);
    const rows = (data ?? []) as TaxRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export class SupabaseDataProvider implements DataProvider {
  readonly id = "supabase";
  private client: SupabaseClient;
  private primaryMetric: string;
  private summaryCache: DatasetSummary | null = null;
  private activeYear: number | null = null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRole) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for DATA_PROVIDER=supabase."
      );
    }
    this.client = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.primaryMetric = process.env.SUPABASE_PRIMARY_METRIC || "N1";
  }

  private async resolveActiveYear(): Promise<number> {
    const envYear = Number(process.env.SUPABASE_QUERY_YEAR || "");
    if (Number.isFinite(envYear) && envYear > 0) return Math.floor(envYear);
    if (this.activeYear != null) return this.activeYear;
    const latest = await this.client
      .from("zip_tax_metrics")
      .select("latest_year")
      .order("latest_year", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) {
      throw new Error(`[supabase] failed to resolve latest year: ${latest.error.message}`);
    }
    const year = latest.data?.latest_year;
    if (!year) {
      throw new Error("[supabase] no rows found in zip_tax_metrics.");
    }
    this.activeYear = year;
    return year;
  }

  async getSummary(): Promise<DatasetSummary> {
    if (this.summaryCache) return this.summaryCache;

    const activeYear = await this.resolveActiveYear();
    const [minYearResult, maxYearResult, countResult, sampleResult] = await Promise.all([
      this.client
        .from("zip_tax_metrics")
        .select("earliest_year")
        .order("earliest_year", { ascending: true })
        .limit(1)
        .maybeSingle(),
      this.client
        .from("zip_tax_metrics")
        .select("latest_year")
        .order("latest_year", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.client
        .from("zip_tax_metrics")
        .select("zip", { count: "exact", head: true }),
      this.client
        .from("zip_tax_metrics")
        .select("metrics,earliest_year,latest_year")
        .eq("latest_year", activeYear)
        .limit(1)
        .maybeSingle(),
    ]);
    if (countResult.error) {
      throw new Error(`[supabase] summary count failed: ${countResult.error.message}`);
    }
    if (sampleResult.error) {
      throw new Error(`[supabase] summary sample failed: ${sampleResult.error.message}`);
    }
    if (minYearResult.error) {
      throw new Error(`[supabase] min year query failed: ${minYearResult.error.message}`);
    }
    if (maxYearResult.error) {
      throw new Error(`[supabase] max year query failed: ${maxYearResult.error.message}`);
    }

    const sampleMetrics = (sampleResult.data?.metrics ??
      {}) as Record<string, MetricEntry>;
    const metricColumns = Object.keys(sampleMetrics).map((name) => ({
      name,
      type: "number" as const,
    }));

    const earliest = minYearResult.data?.earliest_year ?? undefined;
    const latest = maxYearResult.data?.latest_year ?? undefined;
    const yearRange =
      typeof earliest === "number" && typeof latest === "number"
        ? ([earliest, latest] as [number, number])
        : undefined;

    this.summaryCache = {
      datasetId: "supabase-us-zip-tax",
      description:
        `US ZIP-level IRS tax rollups and boundaries loaded from Supabase (active year ${activeYear}).`,
      rowCount: countResult.count ?? 0,
      geography: "us_zip",
      yearRange,
      primaryMetric: this.primaryMetric,
      columns: metricColumns.length > 0 ? metricColumns : [{ name: "N1", type: "number" }],
      rollups: {
        source: "supabase",
        activeYear,
      },
    };
    return this.summaryCache;
  }

  async query(filters: DataFilters): Promise<DataQueryResult> {
    const stateFips = filters.usStateFips?.trim() || undefined;
    const year = filters.year ?? (await this.resolveActiveYear());
    let rows: TaxRow[] = [];
    let selectedMetric = (filters.metric || this.primaryMetric || "").trim();
    const requestedZips = normalizeZips(filters.zips);

    if (requestedZips.length > 0) {
      const { data, error } = await this.client
        .from("zip_tax_metrics")
        .select("zip,state_fips,name,earliest_year,latest_year,metrics")
        .eq("latest_year", year)
        .in("zip", requestedZips);
      if (error) throw new Error(`[supabase] zip query failed: ${error.message}`);
      rows = (data ?? []) as TaxRow[];
      if (stateFips) rows = rows.filter((r) => r.state_fips === stateFips);
    } else if (filters.topN && filters.topN > 0) {
      rows = await fetchAllTaxRows(this.client, year, stateFips);
      const sampleMetrics = rows[0]?.metrics ?? {};
      selectedMetric =
        resolveMetricKey(sampleMetrics, selectedMetric) ?? selectedMetric.toLowerCase();
      const scored = rows
        .map((r) => {
          const v = metricValue((r.metrics ?? {})[selectedMetric]);
          return { row: r, value: v ?? Number.NEGATIVE_INFINITY };
        })
        .filter((x) => Number.isFinite(x.value))
        .sort((a, b) => b.value - a.value)
        .slice(0, Math.min(filters.topN, 5000));
      rows = scored.map((x) => x.row);
    } else {
      return { features: [], kpis: [] };
    }

    if (rows.length === 0) return { features: [], kpis: [] };
    const zips = rows.map((r) => r.zip);
    const { data: boundaries, error: boundaryErr } = await this.client
      .from("zip_boundaries")
      .select("zip,state_fips,name,geometry_geojson,centroid_lat,centroid_lng")
      .in("zip", zips);
    if (boundaryErr) {
      throw new Error(`[supabase] boundary query failed: ${boundaryErr.message}`);
    }

    const boundaryByZip = new Map<string, BoundaryRow>();
    for (const b of (boundaries ?? []) as BoundaryRow[]) {
      boundaryByZip.set(b.zip, b);
    }

    const sampleMetrics = rows[0]?.metrics ?? {};
    selectedMetric =
      resolveMetricKey(sampleMetrics, selectedMetric) ?? selectedMetric.toLowerCase();

    const features: GeoFeature[] = [];
    for (const r of rows) {
      const b = boundaryByZip.get(r.zip);
      if (!b?.geometry_geojson) continue;
      const label = b.name || r.name || `ZIP ${r.zip}`;
      features.push({
        id: r.zip,
        kind: "polygon",
        geometry: b.geometry_geojson,
        label,
        value: metricValue((r.metrics ?? {})[selectedMetric]),
        properties: {
          iso3: "",
          name: label,
          note: selectedMetric,
          zip: r.zip,
          state: r.state_fips ?? "",
        },
      });
    }

    const stateCount =
      stateFips != null
        ? (
            await this.client
              .from("zip_tax_metrics")
              .select("zip", { count: "exact", head: true })
              .eq("latest_year", year)
              .eq("state_fips", stateFips)
          ).count ?? 0
        : null;

    return {
      features,
      kpis: zipKpisForSelection(features, selectedMetric, stateFips, stateCount),
    };
  }
}
