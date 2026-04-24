import { promises as fs } from "node:fs";
import path from "node:path";
import type { FeatureCollection } from "geojson";
import type {
  DataFilters,
  DataProvider,
  DataQueryResult,
} from "../provider";
import type { DatasetSummary, GeoFeature, Kpi } from "../../llm/types";

interface SummaryFile {
  datasetId: string;
  description: string;
  rowCount: number;
  yearRange?: [number, number];
  columns: Array<{ name: string; type: "number" | "string"; example?: unknown }>;
  primaryMetric: string | null;
  sampleRows?: unknown;
}

interface RollupsFile {
  countries: Record<
    string,
    {
      iso3: string;
      name: string;
      earliestYear?: number;
      latestYear?: number;
      metrics: Record<
        string,
        {
          earliest: number | null;
          latest: number | null;
          delta: number | null;
          min: number;
          max: number;
          mean: number;
        }
      >;
    }
  >;
  global: {
    primaryMetric: string | null;
    avgDelta: number | null;
    improvedCount: number;
    declinedCount: number;
    topGainer: { iso3: string; name: string; delta: number } | null;
    topLoser: { iso3: string; name: string; delta: number } | null;
  };
}

const base = path.join(process.cwd(), "public", "data", "kaggle");

let cache: {
  summary: SummaryFile;
  rollups: RollupsFile;
  features: FeatureCollection;
} | null = null;

async function load() {
  if (cache) return cache;
  const [summary, rollups, features] = await Promise.all([
    fs.readFile(path.join(base, "summary.json"), "utf8").then(JSON.parse) as Promise<SummaryFile>,
    fs.readFile(path.join(base, "rollups.json"), "utf8").then(JSON.parse) as Promise<RollupsFile>,
    fs.readFile(path.join(base, "features.geojson"), "utf8").then(JSON.parse) as Promise<FeatureCollection>,
  ]);
  cache = { summary, rollups, features };
  return cache;
}

export class KaggleDataProvider implements DataProvider {
  readonly id = "kaggle";

  async getSummary(): Promise<DatasetSummary> {
    const { summary, rollups } = await load();
    return {
      datasetId: summary.datasetId,
      description: summary.description,
      rowCount: summary.rowCount,
      yearRange: summary.yearRange,
      columns: summary.columns,
      rollups: {
        primaryMetric: summary.primaryMetric,
        global: rollups.global,
        countries: rollups.countries,
      },
    };
  }

  async query(filters: DataFilters): Promise<DataQueryResult> {
    const { rollups, features } = await load();

    const metric = filters.metric ?? rollups.global.primaryMetric ?? "";
    const iso3Filter = filters.countries
      ? new Set(filters.countries.map((c) => c.toUpperCase()))
      : null;

    const geoFeatures: GeoFeature[] = [];
    for (const f of features.features) {
      const iso3 = String((f.properties as { iso3?: string } | null)?.iso3 ?? f.id);
      if (iso3Filter && !iso3Filter.has(iso3)) continue;
      const country = rollups.countries[iso3];
      const metricEntry = country?.metrics[metric];
      geoFeatures.push({
        id: iso3,
        kind: "polygon",
        geometry: f.geometry,
        label: country?.name,
        value: metricEntry?.latest ?? undefined,
        properties: {
          iso3,
          name: country?.name,
          delta: metricEntry?.delta ?? null,
        },
      });
    }

    const kpis: Kpi[] = [];
    const g = rollups.global;
    if (g.topGainer) {
      kpis.push({
        id: "top_gainer",
        label: "Top gainer",
        value: g.topGainer.name,
        delta: g.topGainer.delta,
        direction: "up",
      });
    }
    if (g.avgDelta !== null) {
      kpis.push({
        id: "avg_delta",
        label: "Avg change",
        value: g.avgDelta,
        direction: g.avgDelta >= 0 ? "up" : "down",
      });
    }
    kpis.push({
      id: "improved",
      label: "Countries improved",
      value: g.improvedCount,
      direction: "up",
    });
    kpis.push({
      id: "declined",
      label: "Countries declined",
      value: g.declinedCount,
      direction: "down",
    });

    return { features: geoFeatures, kpis };
  }
}
