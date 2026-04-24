/*
 * Build-time Kaggle ingestion.
 *
 * Downloads a Kaggle dataset using the Kaggle REST API, unzips it, parses the
 * target CSV, normalizes country names to ISO-3, joins to world-atlas country
 * polygons, pre-computes rollups, and writes three artifacts into
 * `public/data/kaggle/` that the runtime provider reads.
 *
 * Fails soft: when DATA_PROVIDER != "kaggle" or KAGGLE_* env vars are missing,
 * this script logs a warning and exits 0 so local dev works without creds.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse as parseCsv } from "csv-parse/sync";
import * as topojson from "topojson-client";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Point,
} from "geojson";
import countries110m from "world-atlas/countries-110m.json" with { type: "json" };
import { nameToIso3 } from "../src/lib/data/geo";

type Row = Record<string, string>;

type CountryRollup = {
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
};

type GlobalRollup = {
  primaryMetric: string | null;
  avgDelta: number | null;
  improvedCount: number;
  declinedCount: number;
  topGainer: { iso3: string; name: string; delta: number } | null;
  topLoser: { iso3: string; name: string; delta: number } | null;
};

const outDir = path.join(process.cwd(), "public", "data", "kaggle");

function log(...args: unknown[]) {
  console.log("[kaggle]", ...args);
}

function warn(...args: unknown[]) {
  console.warn("[kaggle]", ...args);
}

async function main() {
  const dataProvider = process.env.DATA_PROVIDER ?? "static";
  const username = process.env.KAGGLE_USERNAME;
  const key = process.env.KAGGLE_KEY;
  const dataset = process.env.KAGGLE_DATASET;

  if (dataProvider !== "kaggle") {
    log(
      `DATA_PROVIDER=${dataProvider} (not "kaggle"). Skipping Kaggle ingestion.`
    );
    return;
  }

  if (!username || !key || !dataset) {
    warn(
      "DATA_PROVIDER=kaggle but KAGGLE_USERNAME/KAGGLE_KEY/KAGGLE_DATASET are not all set. Skipping ingestion (runtime will fall back to StaticDataProvider)."
    );
    return;
  }

  const targetFile = process.env.KAGGLE_FILE;
  const mode =
    (process.env.KAGGLE_GEO_MODE as "latlon" | "country") ?? "country";
  const countryCol = process.env.KAGGLE_COUNTRY_COL ?? "Country";
  const latCol = process.env.KAGGLE_LAT_COL ?? "lat";
  const lonCol = process.env.KAGGLE_LON_COL ?? "lon";
  const metric = process.env.KAGGLE_METRIC ?? "";

  log(`Downloading dataset ${dataset}...`);
  const csvText = await downloadCsv({ dataset, targetFile, username, key });
  log(`Parsing CSV (${csvText.length} chars)...`);
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Row[];
  log(`Parsed ${rows.length} rows.`);

  if (rows.length === 0) {
    warn("CSV was empty. Aborting.");
    return;
  }

  const columns = detectColumns(rows);
  const hasYear = columns.some(
    (c) => c.name.toLowerCase() === "year" && c.type === "number"
  );
  const yearCol = columns.find((c) => c.name.toLowerCase() === "year")?.name;

  const numericMetrics = columns
    .filter(
      (c) => c.type === "number" && c.name !== yearCol && c.name !== latCol && c.name !== lonCol
    )
    .map((c) => c.name);

  const primaryMetric =
    metric && numericMetrics.includes(metric)
      ? metric
      : numericMetrics[0] ?? null;

  let features: FeatureCollection;
  let rollups: {
    countries: Record<string, CountryRollup>;
    global: GlobalRollup;
  };
  let yearRange: [number, number] | undefined;

  if (mode === "country") {
    const result = buildCountryArtifacts({
      rows,
      countryCol,
      yearCol,
      numericMetrics,
      primaryMetric,
    });
    features = result.features;
    rollups = result.rollups;
    yearRange = result.yearRange;
  } else {
    const result = buildLatLonArtifacts({
      rows,
      latCol,
      lonCol,
      yearCol,
      primaryMetric,
    });
    features = result.features;
    rollups = { countries: {}, global: emptyGlobal(primaryMetric) };
    yearRange = result.yearRange;
  }

  const summary = {
    datasetId: dataset,
    description: buildDescription({
      dataset,
      rowCount: rows.length,
      yearRange,
      primaryMetric,
    }),
    rowCount: rows.length,
    yearRange,
    columns,
    primaryMetric,
    sampleRows: rows.slice(0, 3),
  };

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "features.geojson"),
    JSON.stringify(features)
  );
  await fs.writeFile(
    path.join(outDir, "rollups.json"),
    JSON.stringify(rollups)
  );
  await fs.writeFile(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2)
  );
  log(
    `Wrote ${features.features.length} features, ${Object.keys(rollups.countries).length} country rollups.`
  );
}

async function downloadCsv({
  dataset,
  targetFile,
  username,
  key,
}: {
  dataset: string;
  targetFile?: string;
  username: string;
  key: string;
}): Promise<string> {
  const url = `https://www.kaggle.com/api/v1/datasets/download/${dataset}`;
  const auth = Buffer.from(`${username}:${key}`).toString("base64");
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "User-Agent": "geo-spatial-ai/1.0",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Kaggle API returned ${res.status}: ${await res.text().catch(() => "")}`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const csvEntry = targetFile
    ? entries.find((e) => e.entryName === targetFile)
    : entries.find((e) => e.entryName.toLowerCase().endsWith(".csv"));
  if (!csvEntry) {
    const names = entries.map((e) => e.entryName).join(", ");
    throw new Error(
      `Could not find CSV in dataset zip. Files: ${names}. Set KAGGLE_FILE explicitly.`
    );
  }
  return csvEntry.getData().toString("utf8");
}

function detectColumns(
  rows: Row[]
): Array<{ name: string; type: "number" | "string"; example?: unknown }> {
  const first = rows[0];
  return Object.keys(first).map((name) => {
    const sample = rows
      .slice(0, 50)
      .map((r) => r[name])
      .filter((v) => v !== undefined && v !== "");
    const allNumeric =
      sample.length > 0 &&
      sample.every((v) => v !== "" && !Number.isNaN(Number(v)));
    return {
      name,
      type: allNumeric ? ("number" as const) : ("string" as const),
      example: sample[0],
    };
  });
}

function toNum(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function emptyGlobal(primary: string | null): GlobalRollup {
  return {
    primaryMetric: primary,
    avgDelta: null,
    improvedCount: 0,
    declinedCount: 0,
    topGainer: null,
    topLoser: null,
  };
}

/**
 * Build ISO-3 -> polygon Feature index from world-atlas, matched by name.
 */
function loadCountryPolygons(): Map<string, Feature<Polygon | MultiPolygon>> {
  const topology = countries110m as unknown as Parameters<typeof topojson.feature>[0];
  const collection = topojson.feature(
    topology,
    (topology as unknown as { objects: { countries: unknown } }).objects
      .countries as Parameters<typeof topojson.feature>[1]
  ) as FeatureCollection<Polygon | MultiPolygon>;

  const index = new Map<string, Feature<Polygon | MultiPolygon>>();
  for (const f of collection.features) {
    const name = (f.properties as { name?: string } | null)?.name;
    if (!name) continue;
    const iso3 = nameToIso3(name);
    if (!iso3) continue;
    index.set(iso3, { ...f, id: iso3, properties: { iso3, name } });
  }
  return index;
}

function buildCountryArtifacts({
  rows,
  countryCol,
  yearCol,
  numericMetrics,
  primaryMetric,
}: {
  rows: Row[];
  countryCol: string;
  yearCol: string | undefined;
  numericMetrics: string[];
  primaryMetric: string | null;
}): {
  features: FeatureCollection;
  rollups: {
    countries: Record<string, CountryRollup>;
    global: GlobalRollup;
  };
  yearRange?: [number, number];
} {
  const polygons = loadCountryPolygons();
  log(`Loaded ${polygons.size} country polygons.`);

  const byIso: Map<string, Row[]> = new Map();
  let unmatched = 0;
  for (const row of rows) {
    const iso3 = nameToIso3(row[countryCol]);
    if (!iso3) {
      unmatched += 1;
      continue;
    }
    if (!byIso.has(iso3)) byIso.set(iso3, []);
    byIso.get(iso3)!.push(row);
  }
  if (unmatched > 0) {
    warn(`${unmatched} rows had unknown country names (skipped).`);
  }

  const rollups: Record<string, CountryRollup> = {};
  const globalMetric = primaryMetric;
  const allYears: number[] = [];

  for (const [iso3, group] of byIso.entries()) {
    const name =
      (polygons.get(iso3)?.properties as { name?: string } | null)?.name ??
      iso3;

    let earliestYear: number | undefined;
    let latestYear: number | undefined;

    if (yearCol) {
      const years = group
        .map((r) => toNum(r[yearCol]))
        .filter((v): v is number => v !== null);
      if (years.length > 0) {
        earliestYear = Math.min(...years);
        latestYear = Math.max(...years);
        allYears.push(earliestYear, latestYear);
      }
    }

    const metrics: CountryRollup["metrics"] = {};
    for (const m of numericMetrics) {
      const values = group
        .map((r) => toNum(r[m]))
        .filter((v): v is number => v !== null);
      if (values.length === 0) continue;

      let earliest: number | null = null;
      let latest: number | null = null;
      if (yearCol && earliestYear !== undefined && latestYear !== undefined) {
        const earliestRow = group.find(
          (r) => toNum(r[yearCol]) === earliestYear
        );
        const latestRow = group.find((r) => toNum(r[yearCol]) === latestYear);
        earliest = earliestRow ? toNum(earliestRow[m]) : null;
        latest = latestRow ? toNum(latestRow[m]) : null;
      }
      const delta =
        earliest !== null && latest !== null
          ? Number((latest - earliest).toFixed(3))
          : null;

      metrics[m] = {
        earliest,
        latest,
        delta,
        min: Number(Math.min(...values).toFixed(3)),
        max: Number(Math.max(...values).toFixed(3)),
        mean: Number(mean(values).toFixed(3)),
      };
    }

    rollups[iso3] = {
      iso3,
      name,
      earliestYear,
      latestYear,
      metrics,
    };
  }

  const features: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  for (const [iso3, rollup] of Object.entries(rollups)) {
    const poly = polygons.get(iso3);
    if (!poly) continue;
    const value =
      globalMetric && rollup.metrics[globalMetric]
        ? rollup.metrics[globalMetric].latest
        : null;
    features.features.push({
      type: "Feature",
      id: iso3,
      geometry: poly.geometry,
      properties: {
        iso3,
        name: rollup.name,
        value,
        metric: globalMetric,
      },
    });
  }

  const globalRollup = computeGlobalRollup(rollups, globalMetric);
  const yearRange =
    allYears.length > 0
      ? ([Math.min(...allYears), Math.max(...allYears)] as [number, number])
      : undefined;

  return {
    features,
    rollups: { countries: rollups, global: globalRollup },
    yearRange,
  };
}

function computeGlobalRollup(
  countries: Record<string, CountryRollup>,
  primary: string | null
): GlobalRollup {
  if (!primary) return emptyGlobal(primary);
  const deltas: Array<{ iso3: string; name: string; delta: number }> = [];
  for (const c of Object.values(countries)) {
    const m = c.metrics[primary];
    if (!m || m.delta === null) continue;
    deltas.push({ iso3: c.iso3, name: c.name, delta: m.delta });
  }
  if (deltas.length === 0) return emptyGlobal(primary);
  deltas.sort((a, b) => b.delta - a.delta);
  return {
    primaryMetric: primary,
    avgDelta: Number(
      mean(deltas.map((d) => d.delta)).toFixed(3)
    ),
    improvedCount: deltas.filter((d) => d.delta > 0).length,
    declinedCount: deltas.filter((d) => d.delta < 0).length,
    topGainer: deltas[0] ?? null,
    topLoser: deltas[deltas.length - 1] ?? null,
  };
}

function buildLatLonArtifacts({
  rows,
  latCol,
  lonCol,
  yearCol,
  primaryMetric,
}: {
  rows: Row[];
  latCol: string;
  lonCol: string;
  yearCol: string | undefined;
  primaryMetric: string | null;
}): { features: FeatureCollection; yearRange?: [number, number] } {
  const features: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: [],
  };
  const years: number[] = [];
  rows.forEach((row, i) => {
    const lat = toNum(row[latCol]);
    const lon = toNum(row[lonCol]);
    if (lat === null || lon === null) return;
    if (yearCol) {
      const y = toNum(row[yearCol]);
      if (y !== null) years.push(y);
    }
    features.features.push({
      type: "Feature",
      id: `row-${i}`,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        value: primaryMetric ? toNum(row[primaryMetric]) : null,
        ...row,
      },
    });
  });
  const yearRange =
    years.length > 0
      ? ([Math.min(...years), Math.max(...years)] as [number, number])
      : undefined;
  return { features, yearRange };
}

function buildDescription({
  dataset,
  rowCount,
  yearRange,
  primaryMetric,
}: {
  dataset: string;
  rowCount: number;
  yearRange?: [number, number];
  primaryMetric: string | null;
}): string {
  const parts = [`Kaggle dataset '${dataset}' with ${rowCount} rows.`];
  if (yearRange) parts.push(`Temporal coverage ${yearRange[0]}-${yearRange[1]}.`);
  if (primaryMetric) parts.push(`Primary metric: ${primaryMetric}.`);
  return parts.join(" ");
}

main().catch((err) => {
  console.error("[kaggle] ingestion failed:", err);
  process.exitCode = 1;
});
