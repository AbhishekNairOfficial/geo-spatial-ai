import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DataFilters,
  DataProvider,
  DataQueryResult,
} from "../provider";
import type { DatasetSummary, GeoFeature, Kpi } from "../../llm/types";

interface SampleSite {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  metric: number;
}

interface SampleFile {
  datasetId: string;
  description: string;
  sites: SampleSite[];
}

let cached: SampleFile | null = null;

async function load(): Promise<SampleFile> {
  if (cached) return cached;
  const file = path.join(process.cwd(), "public", "data", "sample-sites.json");
  const json = JSON.parse(await fs.readFile(file, "utf8")) as SampleFile;
  cached = json;
  return json;
}

export class StaticDataProvider implements DataProvider {
  readonly id = "static";

  async getSummary(): Promise<DatasetSummary> {
    const file = await load();
    return {
      datasetId: file.datasetId,
      description: file.description,
      rowCount: file.sites.length,
      geography: "static",
      primaryMetric: null,
      columns: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "longitude", type: "number" },
        { name: "latitude", type: "number" },
        { name: "metric", type: "number" },
      ],
      rollups: {
        sites: file.sites.map((s) => ({ id: s.id, name: s.name, metric: s.metric })),
      },
    };
  }

  async query(_filters: DataFilters): Promise<DataQueryResult> {
    const file = await load();
    const features: GeoFeature[] = file.sites.map((s) => ({
      id: s.id,
      kind: "point",
      geometry: {
        type: "Point",
        coordinates: [s.longitude, s.latitude],
      },
      label: s.name,
      value: s.metric,
      properties: {
        iso3: s.id,
        name: s.name,
        note: "",
        zip: "",
        state: "",
      },
    }));

    const values = file.sites.map((s) => s.metric);
    const kpis: Kpi[] = [
      {
        id: "sites",
        label: "Reference sites",
        value: file.sites.length,
        unit: "",
        direction: "flat",
        delta: 0,
        timeframe: "",
      },
      {
        id: "avg",
        label: "Average metric",
        value: Number(
          (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
        ),
        unit: "",
        direction: "flat",
        delta: 0,
        timeframe: "",
      },
    ];

    return { features, kpis };
  }
}
