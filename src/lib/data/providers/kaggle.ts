import { promises as fs } from "node:fs";
import path from "node:path";
import type { FeatureCollection } from "geojson";
import type {
  DataFilters,
  DataProvider,
  DataQueryResult,
} from "../provider";
import { fipsToUsps } from "@/lib/geo/usStateFips";
import type { DatasetSummary, GeoFeature, Kpi } from "../../llm/types";

interface SummaryFile {
  datasetId: string;
  description: string;
  rowCount: number;
  yearRange?: [number, number];
  geography?: "world" | "us_zip" | "static";
  primaryMetric?: string | null;
  columns: Array<{ name: string; type: "number" | "string"; example?: unknown }>;
  sampleRows?: unknown;
}

interface MetricEntry {
  earliest: number | null;
  latest: number | null;
  delta: number | null;
  min: number;
  max: number;
  mean: number;
}

interface CountryOrZipRollup {
  iso3?: string;
  zip?: string;
  name: string;
  state?: string;
  earliestYear?: number;
  latestYear?: number;
  metrics: Record<string, MetricEntry>;
}

interface GlobalRollupBase {
  primaryMetric: string | null;
  avgDelta: number | null;
  improvedCount: number;
  declinedCount: number;
  topGainer: {
    iso3?: string;
    zip?: string;
    name: string;
    delta: number;
  } | null;
  topLoser: {
    iso3?: string;
    zip?: string;
    name: string;
    delta: number;
  } | null;
}

interface RollupsFile {
  countries?: Record<string, CountryOrZipRollup & { iso3: string }>;
  zips?: Record<string, CountryOrZipRollup & { zip: string; state: string }>;
  global: GlobalRollupBase;
}

const base = path.join(process.cwd(), "public", "data", "kaggle");

/**
 * On Vercel, large `public/data/kaggle/*` files must not be file-traced into
 * the serverless bundle (250 MB limit). Load same-origin over HTTP there; use
 * `fs` locally and on other hosts.
 */
function kaggleDataViaHttp(): boolean {
  return process.env.VERCEL === "1" && Boolean(process.env.VERCEL_URL);
}

async function readKaggleFile(name: string): Promise<string> {
  if (kaggleDataViaHttp()) {
    const url = `https://${process.env.VERCEL_URL}/data/kaggle/${name}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(
        `[kaggle] ${res.status} when fetching ${url} (is Kaggle data in public/?)`
      );
    }
    return res.text();
  }
  return fs.readFile(path.join(base, name), "utf8");
}

let cache: {
  summary: SummaryFile;
  rollups: RollupsFile;
  features: FeatureCollection;
} | null = null;

async function load() {
  if (cache) return cache;
  const [summary, rollups, features] = await Promise.all([
    readKaggleFile("summary.json").then(
      (s) => JSON.parse(s) as SummaryFile
    ),
    readKaggleFile("rollups.json").then(
      (s) => JSON.parse(s) as RollupsFile
    ),
    readKaggleFile("features.geojson").then(
      (s) => JSON.parse(s) as FeatureCollection
    ),
  ]);
  cache = { summary, rollups, features };
  return cache;
}

function getMetricValue(m: MetricEntry | undefined, prefer: "latest" | "mean" = "latest") {
  if (!m) return undefined;
  if (prefer === "latest" && m.latest !== null) return m.latest;
  return m.mean;
}

/** Rollup JSON uses lowercase keys (e.g. `n1`); the LLM often sends `N1`. */
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

function normalizeZips(codes: string[] | undefined): string[] {
  if (!codes?.length) return [];
  return codes
    .map((z) => z.replace(/\D/g, "").slice(-5).padStart(5, "0"))
    .filter((z) => z.length === 5);
}

function zipKpis(rollups: RollupsFile): Kpi[] {
  const g = rollups.global;
  const topCode = g.topGainer?.zip;
  const out: Kpi[] = [
    {
      id: "primary_metric",
      label: "Primary metric",
      value: g.primaryMetric ?? "—",
      unit: "",
      direction: "flat",
      delta: 0,
      timeframe: "",
    },
  ];
  if (g.topGainer) {
    out.push({
      id: "top_gainer",
      label: "Largest positive delta (ZIP)",
      value: topCode ? `ZIP ${topCode}` : g.topGainer.name,
      unit: "",
      direction: "up",
      delta: g.topGainer.delta,
      timeframe: "",
    });
  }
  if (g.avgDelta !== null) {
    out.push({
      id: "avg_delta",
      label: "Avg change (ZIP)",
      value: g.avgDelta,
      unit: "",
      direction: g.avgDelta >= 0 ? "up" : "down",
      delta: g.avgDelta,
      timeframe: "",
    });
  }
  return out;
}

/**
 * KPIs for the current map selection (and optional state scope). Replaces
 * `zipKpis(rollups)` for queries so we do not show US-global numbers when the
 * user asked for e.g. Washington only.
 */
function zipKpisForSelection(
  rollups: RollupsFile,
  geoFeatures: GeoFeature[],
  metricKey: string,
  stateFips: string | undefined
): Kpi[] {
  const m =
    (metricKey?.trim() || rollups.global.primaryMetric || "metric") as string;
  const st = stateFips?.trim();
  const stLabel = st
    ? `${fipsToUsps(st) ?? "State"} (${st})`
    : "US-wide";

  const out: Kpi[] = [
    {
      id: "zip_highlight_count",
      label: "ZIPs on map (this answer)",
      value: geoFeatures.length,
      unit: "",
      direction: "flat",
      delta: 0,
      timeframe: st ? `Scope: ${stLabel}` : "Scope: all states",
    },
  ];

  const values = geoFeatures
    .map((f) => f.value)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length > 0) {
    out.push({
      id: "max_in_view",
      label: `Largest ${m} among highlighted ZIPs`,
      value: Math.max(...values),
      unit: "",
      direction: "flat",
      delta: 0,
      timeframe: "",
    });
  }

  if (st && rollups.zips) {
    let inState = 0;
    for (const r of Object.values(rollups.zips)) {
      if (r.state === st) inState += 1;
    }
    out.push({
      id: "state_rollup_count",
      label: `ZCTAs with data in ${stLabel}`,
      value: inState,
      unit: "",
      direction: "flat",
      delta: 0,
      timeframe: "Ingested IRS rows for this state",
    });
  }

  return out;
}

export class KaggleDataProvider implements DataProvider {
  readonly id = "kaggle";

  async getSummary(): Promise<DatasetSummary> {
    const { summary, rollups } = await load();
    return {
      datasetId: summary.datasetId,
      description: summary.description,
      rowCount: summary.rowCount,
      geography: summary.geography,
      yearRange: summary.yearRange,
      primaryMetric: summary.primaryMetric ?? null,
      columns: summary.columns,
      rollups: {
        primaryMetric: summary.primaryMetric,
        global: rollups.global,
        countries: rollups.countries,
        zips: rollups.zips,
      },
    };
  }

  async query(filters: DataFilters): Promise<DataQueryResult> {
    const { rollups, features } = await load();

    if (rollups.zips) {
      return this.queryZips(rollups, features, filters);
    }

    return this.queryCountries(rollups, features, filters);
  }

  private queryZips(
    rollups: RollupsFile,
    features: FeatureCollection,
    filters: DataFilters
  ): DataQueryResult {
    const zipRollups = rollups.zips!;
    const globalPrimary = rollups.global.primaryMetric ?? "";
    const rawMetric =
      filters.metric && filters.metric.length > 0 ? filters.metric : globalPrimary;
    const sampleRow = Object.values(zipRollups)[0];
    const metric =
      sampleRow && rawMetric
        ? resolveMetricKey(sampleRow.metrics, rawMetric) ?? rawMetric.toLowerCase()
        : rawMetric ?? "";

    const stateFips = filters.usStateFips?.trim() || undefined;

    let zips = normalizeZips(filters.zips);
    if (stateFips && zips.length > 0) {
      zips = zips.filter((z) => zipRollups[z]?.state === stateFips);
    }

    if (zips.length === 0 && filters.topN && filters.topN > 0 && metric) {
      const scored: { zip: string; score: number; name: string; state: string }[] = [];
      for (const r of Object.values(zipRollups)) {
        if (stateFips && r.state !== stateFips) continue;
        const me = r.metrics[metric];
        if (!me) continue;
        const score = (me.latest ?? me.mean) ?? 0;
        if (Number.isNaN(Number(score))) continue;
        scored.push({ zip: r.zip, score: Number(score), name: r.name, state: r.state });
      }
      scored.sort((a, b) => b.score - a.score);
      zips = scored.slice(0, Math.min(filters.topN, 5000)).map((s) => s.zip);
    }

    const zset = zips.length > 0 ? new Set(zips) : null;
    if (!zset) {
      return { features: [], kpis: zipKpis(rollups) };
    }

    const geoFeatures: GeoFeature[] = [];
    for (const f of features.features) {
      const p = f.properties as {
        zip?: string;
        state?: string;
        name?: string;
        value?: number;
        metric?: string;
      } | null;
      const z = p?.zip ?? (f.id != null ? String(f.id) : undefined);
      if (!z) continue;
      if (zset && !zset.has(z)) continue;
      const row = zipRollups[z];
      const metricEntry = metric ? row?.metrics[metric] : undefined;
      const v = getMetricValue(metricEntry, "latest");
      const label = row?.name ?? p?.name ?? `ZIP ${z}`;
      geoFeatures.push({
        id: z,
        kind: "polygon",
        geometry: f.geometry,
        label,
        value: p?.value ?? v,
        properties: {
          iso3: "",
          name: label,
          note: metric,
          zip: z,
          state: row?.state ?? p?.state ?? "",
        },
      });
    }

    return {
      features: geoFeatures,
      kpis: zipKpisForSelection(rollups, geoFeatures, metric, stateFips),
    };
  }

  private queryCountries(
    rollups: RollupsFile,
    features: FeatureCollection,
    filters: DataFilters
  ): DataQueryResult {
    const r = rollups;
    const fc = features;
    const metric = filters.metric ?? r.global.primaryMetric ?? "";
    const iso3Filter = filters.countries
      ? new Set(filters.countries.map((c) => c.toUpperCase()))
      : null;

    const countries = r.countries ?? {};
    const geoFeatures: GeoFeature[] = [];
    for (const f of fc.features) {
      const iso3 = String(
        (f.properties as { iso3?: string } | null)?.iso3 ?? f.id
      );
      if (iso3Filter && !iso3Filter.has(String(iso3).toUpperCase())) continue;
      const country = countries[iso3];
      const metricEntry = country?.metrics[metric];
      geoFeatures.push({
        id: iso3,
        kind: "polygon",
        geometry: f.geometry,
        label: country?.name,
        value: metricEntry?.latest ?? undefined,
        properties: {
          iso3,
          name: country?.name ?? "",
          note: String(metricEntry?.delta ?? ""),
          zip: "",
          state: "",
        },
      });
    }

    const g = r.global;
    const kpis: Kpi[] = [];
    if (g.topGainer) {
      kpis.push({
        id: "top_gainer",
        label: "Top gainer",
        value: g.topGainer.name,
        unit: "",
        direction: "up",
        delta: g.topGainer.delta,
        timeframe: "",
      });
    }
    if (g.avgDelta !== null) {
      kpis.push({
        id: "avg_delta",
        label: "Avg change",
        value: g.avgDelta,
        unit: "",
        direction: g.avgDelta >= 0 ? "up" : "down",
        delta: g.avgDelta,
        timeframe: "",
      });
    }
    kpis.push(
      {
        id: "improved",
        label: "Countries improved",
        value: g.improvedCount,
        unit: "",
        direction: "up",
        delta: 0,
        timeframe: "",
      },
      {
        id: "declined",
        label: "Countries declined",
        value: g.declinedCount,
        unit: "",
        direction: "down",
        delta: 0,
        timeframe: "",
      }
    );

    return { features: geoFeatures, kpis };
  }
}
