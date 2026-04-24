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
 *
 * `KAGGLE_GEO_MODE=us_zip` (or IRS individual-income-tax dataset by default) joins
 * IRS rows to US Census ZCTA (ZIP) polygons. Set `ZCTA_LOCAL_PATH` to a .zip
 * of `cb_2020_us_zcta520_500k` to skip downloading from the Census.
 *
 * Note: this file is run with `tsx` (prebuild / build:data), not through Next.js,
 * so we load `.env` / `.env.local` here — only `next dev` / `next build` read them
 * automatically.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
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

const _repoRoot = process.cwd();
const _envFile = path.join(_repoRoot, ".env");
const _envLocalFile = path.join(_repoRoot, ".env.local");
if (existsSync(_envFile)) loadEnv({ path: _envFile });
if (existsSync(_envLocalFile)) loadEnv({ path: _envLocalFile, override: true });

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

type ZipRollup = {
  zip: string;
  name: string;
  state: string;
  earliestYear?: number;
  latestYear?: number;
  metrics: CountryRollup["metrics"];
};

type GlobalRollupZip = {
  primaryMetric: string | null;
  avgDelta: number | null;
  improvedCount: number;
  declinedCount: number;
  topGainer: { zip: string; name: string; delta: number } | null;
  topLoser: { zip: string; name: string; delta: number } | null;
};

/** Cartographic boundary 1:500,000 (GENZ2020) — not `5m`; that name 404s on Census. */
const CENSUS_ZCTA_500K_ZIP_URL =
  "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip";

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

  const isIrsZipDataset =
    dataset.toLowerCase().includes("irs") &&
    dataset.toLowerCase().includes("individual-income-tax");
  const targetFile =
    process.env.KAGGLE_FILE ??
    (isIrsZipDataset ? "2014.csv" : undefined);
  const defaultGeoMode: "latlon" | "country" | "us_zip" = isIrsZipDataset
    ? "us_zip"
    : "country";
  const mode = (process.env.KAGGLE_GEO_MODE as
    | "latlon"
    | "country"
    | "us_zip"
    | undefined) ?? defaultGeoMode;
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

  let resolvedPrimary: string | null =
    metric && numericMetrics.includes(metric)
      ? metric
      : numericMetrics[0] ?? null;

  let features: FeatureCollection;
  let rollups: {
    countries?: Record<string, CountryRollup>;
    zips?: Record<string, ZipRollup>;
    global: GlobalRollup | GlobalRollupZip;
  };
  let yearRange: [number, number] | undefined;
  let geography: "world" | "us_zip" = "world";

  if (mode === "us_zip") {
    const result = await buildUsZipArtifacts({
      rows,
      yearCol,
      numericMetrics,
      primaryMetric: resolvedPrimary,
    });
    features = result.features;
    rollups = result.rollups;
    yearRange = result.yearRange;
    resolvedPrimary = result.primaryMetric;
    geography = "us_zip";
  } else if (mode === "country") {
    const result = buildCountryArtifacts({
      rows,
      countryCol,
      yearCol,
      numericMetrics,
      primaryMetric: resolvedPrimary,
    });
    features = result.features;
    rollups = result.rollups;
    yearRange = result.yearRange;
    geography = "world";
  } else {
    const result = buildLatLonArtifacts({
      rows,
      latCol,
      lonCol,
      yearCol,
      primaryMetric: resolvedPrimary,
    });
    features = result.features;
    rollups = { countries: {}, global: emptyGlobal(resolvedPrimary) };
    yearRange = result.yearRange;
    geography = "world";
  }

  const summary = {
    datasetId: dataset,
    geography,
    description: buildDescription({
      dataset,
      rowCount: rows.length,
      yearRange,
      primaryMetric: resolvedPrimary,
      geography,
    }),
    rowCount: rows.length,
    yearRange,
    columns,
    primaryMetric: resolvedPrimary,
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
  const rollupCount = rollups.zips
    ? Object.keys(rollups.zips).length
    : Object.keys(rollups.countries ?? {}).length;
  log(
    `Wrote ${features.features.length} features, ${rollupCount} ${rollups.zips ? "ZIP" : "country"} rollups.`
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

function findZipColumn(headers: string[]): string | null {
  const h = headers.map((x) => x.trim());
  const exact = /^(zip|zipcode|zip_code|zcta5|zcta)$/i;
  for (const name of h) {
    if (exact.test(name)) return name;
  }
  for (const name of h) {
    if (/zipcode/i.test(name) || /^zip$/i.test(name) || /zcta5/i.test(name))
      return name;
  }
  return null;
}

function findStateColumn(headers: string[]): string | null {
  for (const name of headers) {
    const t = name.trim();
    if (/^(state|st)$/i.test(t) || t.toLowerCase() === "statefips")
      return name;
  }
  return null;
}

function normalizeZip5(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 0) return null;
  const last5 = d.length >= 5 ? d.slice(-5) : d.padStart(5, "0");
  if (last5 === "00000" || last5 === "99999") return null;
  return last5;
}

function zctaKeyFromProps(
  p: Record<string, unknown> | null | undefined
): string | null {
  if (!p) return null;
  const tryKeys: string[] = [
    "ZCTA5CE20",
    "ZCTA5CE10",
    "ZCTA5CE",
    "ZCTA5",
    "GEOID20",
    "GEOID10",
  ];
  for (const k of tryKeys) {
    if (k in p && p[k] !== undefined && p[k] !== null) {
      const z = normalizeZip5(String(p[k]));
      if (z) return z;
    }
  }
  if (p.GEOID) {
    const s = String(p.GEOID);
    if (s.length >= 5) return normalizeZip5(s);
  }
  return null;
}

/**
 * shpjs expects `self` (browser); Node has only `globalThis`. Set before import.
 */
function ensureWebGlobalsForShpjs() {
  if (typeof (globalThis as { self?: unknown }).self === "undefined") {
    Object.defineProperty(globalThis, "self", {
      value: globalThis,
      configurable: true,
      writable: true,
    });
  }
}

async function loadZctaFeatureCollection(): Promise<
  FeatureCollection<Polygon | MultiPolygon>
> {
  const local = process.env.ZCTA_LOCAL_PATH;
  let buf: Buffer;
  if (local) {
    const resolved = path.resolve(local);
    buf = await fs.readFile(resolved);
    log(
      `Loading ZCTA shapefile zip from ZCTA_LOCAL_PATH (${buf.length} bytes)...`
    );
  } else {
    const url = process.env.ZCTA_TIGER_URL ?? CENSUS_ZCTA_500K_ZIP_URL;
    log(`Downloading ZCTA shapefile: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `ZCTA download failed (${res.status}): set ZCTA_LOCAL_PATH to a local cb_2020_us_zcta520_500k.zip or fix ZCTA_TIGER_URL`
      );
    }
    buf = Buffer.from(await res.arrayBuffer());
    log(`ZCTA download complete (${buf.length} bytes).`);
  }
  ensureWebGlobalsForShpjs();
  const { default: getShapefile } = await import("shpjs");
  const parsed: unknown = await getShapefile(buf);
  const fc = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!fc || typeof fc !== "object" || (fc as FeatureCollection).type !== "FeatureCollection")
    throw new Error("ZCTA parse did not return a GeoJSON FeatureCollection");
  return fc as FeatureCollection<Polygon | MultiPolygon>;
}

function mostCommonStateInGroup(group: Row[], stateCol: string | null): string {
  if (!stateCol) return "";
  const counts = new Map<string, number>();
  for (const r of group) {
    const s = String(r[stateCol] ?? "").trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function computeGlobalRollupZips(
  zips: Record<string, ZipRollup>,
  primary: string | null
): GlobalRollupZip {
  if (!primary) {
    return {
      primaryMetric: null,
      avgDelta: null,
      improvedCount: 0,
      declinedCount: 0,
      topGainer: null,
      topLoser: null,
    };
  }
  const deltas: Array<{ zip: string; name: string; delta: number }> = [];
  for (const c of Object.values(zips)) {
    const m = c.metrics[primary];
    if (!m || m.delta === null) continue;
    deltas.push({ zip: c.zip, name: c.name, delta: m.delta });
  }
  if (deltas.length === 0) {
    return {
      primaryMetric: primary,
      avgDelta: null,
      improvedCount: 0,
      declinedCount: 0,
      topGainer: null,
      topLoser: null,
    };
  }
  deltas.sort((a, b) => b.delta - a.delta);
  return {
    primaryMetric: primary,
    avgDelta: Number(mean(deltas.map((d) => d.delta)).toFixed(3)),
    improvedCount: deltas.filter((d) => d.delta > 0).length,
    declinedCount: deltas.filter((d) => d.delta < 0).length,
    topGainer: deltas[0] ?? null,
    topLoser: deltas[deltas.length - 1] ?? null,
  };
}

async function buildUsZipArtifacts({
  rows,
  yearCol,
  numericMetrics,
  primaryMetric,
}: {
  rows: Row[];
  yearCol: string | undefined;
  numericMetrics: string[];
  primaryMetric: string | null;
}): Promise<{
  features: FeatureCollection;
  rollups: { zips: Record<string, ZipRollup>; global: GlobalRollupZip };
  yearRange?: [number, number];
  primaryMetric: string | null;
}> {
  const headers = Object.keys(rows[0] ?? {});
  const zipCol = findZipColumn(headers);
  const stateCol = findStateColumn(headers);
  if (!zipCol) {
    throw new Error(
      "[kaggle] us_zip mode: no ZIP column found (try naming it zip, zipcode, or ZCTA5)."
    );
  }
  if (!stateCol) warn("[kaggle] us_zip: no state column; labels will be ZIP only.");

  const skipMetrics = new Set(
    [zipCol, stateCol, yearCol].filter((x): x is string => Boolean(x))
  );
  const metrics = numericMetrics.filter(
    (m) => !skipMetrics.has(m) && !/^agi_stub$/i.test(m)
  );
  const globalMetric =
    primaryMetric && metrics.includes(primaryMetric)
      ? primaryMetric
      : metrics.find((m) => m === "N1") ??
        metrics.find((m) => /^A00100$/i.test(m)) ??
        metrics[0] ??
        null;

  const byZip = new Map<string, Row[]>();
  let badZip = 0;
  for (const row of rows) {
    const z = normalizeZip5(String(row[zipCol] ?? ""));
    if (!z) {
      badZip += 1;
      continue;
    }
    if (!byZip.has(z)) byZip.set(z, []);
    byZip.get(z)!.push(row);
  }
  if (badZip > 0) {
    warn(`[kaggle] us_zip: skipped ${badZip} rows with non-ZIP / placeholder codes.`);
  }

  const allYears: number[] = [];
  const zips: Record<string, ZipRollup> = {};

  for (const [zip, group] of byZip) {
    const state = mostCommonStateInGroup(group, stateCol);
    const name = state ? `${state} ${zip}` : `ZIP ${zip}`;

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

    const mets: CountryRollup["metrics"] = {};
    for (const m of metrics) {
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

      mets[m] = {
        earliest,
        latest,
        delta,
        min: Number(Math.min(...values).toFixed(3)),
        max: Number(Math.max(...values).toFixed(3)),
        mean: Number(mean(values).toFixed(3)),
      };
    }

    zips[zip] = {
      zip,
      name,
      state,
      earliestYear,
      latestYear,
      metrics: mets,
    };
  }

  const zctaFc = await loadZctaFeatureCollection();
  const zctaIndex = new Map<string, Feature<Polygon | MultiPolygon>>();
  for (const f of zctaFc.features) {
    const k = zctaKeyFromProps(
      f.properties as Record<string, unknown> | null
    );
    if (k) {
      if (!zctaIndex.has(k))
        zctaIndex.set(k, f as Feature<Polygon | MultiPolygon>);
    }
  }
  log(
    `ZCTA polygons indexed: ${zctaIndex.size} (raw features: ${zctaFc.features.length}).`
  );

  const features: FeatureCollection = { type: "FeatureCollection", features: [] };
  let missingPoly = 0;
  for (const zip of Object.keys(zips)) {
    const poly = zctaIndex.get(zip);
    const rollup = zips[zip]!;
    if (!poly) {
      missingPoly += 1;
      continue;
    }
    const me = globalMetric ? rollup.metrics[globalMetric] : undefined;
    const value =
      me != null ? (me.latest ?? me.mean) : null;
    features.features.push({
      type: "Feature",
      id: zip,
      geometry: poly.geometry,
      properties: {
        zip,
        state: rollup.state,
        name: rollup.name,
        value,
        metric: globalMetric,
      },
    });
  }
  if (missingPoly > 0) {
    warn(
      `[kaggle] us_zip: ${missingPoly} IRS ZIPs had no ZCTA polygon in the TIGER file (dropped from features).`
    );
  }

  const global = computeGlobalRollupZips(zips, globalMetric);
  const yearRange =
    allYears.length > 0
      ? ([Math.min(...allYears), Math.max(...allYears)] as [number, number])
      : undefined;

  return {
    features,
    rollups: { zips, global },
    yearRange,
    primaryMetric: globalMetric,
  };
}

function buildDescription({
  dataset,
  rowCount,
  yearRange,
  primaryMetric,
  geography,
}: {
  dataset: string;
  rowCount: number;
  yearRange?: [number, number];
  primaryMetric: string | null;
  geography?: "world" | "us_zip";
}): string {
  const parts = [`Kaggle dataset '${dataset}' with ${rowCount} rows.`];
  if (geography === "us_zip")
    parts.push("Geography: US only; features are ZCTA (ZIP) polygons from Census TIGER + IRS fields.");
  if (yearRange) parts.push(`Temporal coverage ${yearRange[0]}-${yearRange[1]}.`);
  if (primaryMetric) parts.push(`Primary metric: ${primaryMetric}.`);
  return parts.join(" ");
}

main().catch((err) => {
  console.error("[kaggle] ingestion failed:", err);
  process.exitCode = 1;
});
