import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { FeatureCollection, Geometry } from "geojson";

const root = process.cwd();
const envFile = path.join(root, ".env");
const envLocal = path.join(root, ".env.local");
if (existsSync(envFile)) loadEnv({ path: envFile });
if (existsSync(envLocal)) loadEnv({ path: envLocal, override: true });

type MetricEntry = {
  earliest: number | null;
  latest: number | null;
  delta: number | null;
  min: number;
  max: number;
  mean: number;
};

type ZipRollup = {
  zip: string;
  name: string;
  state: string;
  earliestYear?: number;
  latestYear?: number;
  metrics: Record<string, MetricEntry>;
};

type RollupsFile = {
  zips?: Record<string, ZipRollup>;
};

function toPoints(coords: unknown, out: Array<[number, number]>): void {
  if (!Array.isArray(coords)) return;
  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    out.push([coords[0], coords[1]]);
    return;
  }
  for (const c of coords) toPoints(c, out);
}

function centroidFromGeometry(
  geometry: Geometry
): { lat: number; lng: number } | null {
  const points: Array<[number, number]> = [];
  toPoints((geometry as { coordinates?: unknown }).coordinates, points);
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const base = path.join(root, "public", "data", "kaggle");
  const [rollupsRaw, featuresRaw] = await Promise.all([
    fs.readFile(path.join(base, "rollups.json"), "utf8"),
    fs.readFile(path.join(base, "features.geojson"), "utf8"),
  ]);
  const rollups = JSON.parse(rollupsRaw) as RollupsFile;
  const features = JSON.parse(featuresRaw) as FeatureCollection;
  if (!rollups.zips) {
    throw new Error("rollups.json has no zips section; build us_zip artifacts first.");
  }

  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const taxRows = Object.values(rollups.zips).map((z) => {
    const taxYear =
      z.latestYear ?? z.earliestYear ?? Number(process.env.KAGGLE_TAX_YEAR || "2022");
    return {
      zip: z.zip,
      state_fips: z.state || null,
      name: z.name || null,
      earliest_year: taxYear,
      latest_year: taxYear,
      metrics: z.metrics ?? {},
      source: "kaggle_seed",
      source_url: process.env.KAGGLE_DATASET
        ? `https://www.kaggle.com/datasets/${process.env.KAGGLE_DATASET}`
        : null,
    };
  });

  const featureByZip = new Map<
    string,
    { geometry: Geometry; name: string | null; state: string | null }
  >();
  for (const f of features.features) {
    if (!f.geometry) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const zip = String(props.zip ?? f.id ?? "").trim();
    if (!zip) continue;
    featureByZip.set(zip, {
      geometry: f.geometry,
      name: typeof props.name === "string" ? props.name : null,
      state: typeof props.state === "string" ? props.state : null,
    });
  }

  const boundaryRows = Object.keys(rollups.zips)
    .map((zip) => {
      const f = featureByZip.get(zip);
      if (!f) return null;
      const centroid = centroidFromGeometry(f.geometry);
      return {
        zip,
        state_fips: f.state,
        name: f.name,
        geometry_geojson: f.geometry,
        centroid_lat: centroid?.lat ?? null,
        centroid_lng: centroid?.lng ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const chunkSize = 500;
  for (let i = 0; i < taxRows.length; i += chunkSize) {
    const chunk = taxRows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("zip_tax_metrics")
      .upsert(chunk, { onConflict: "zip,earliest_year" });
    if (error) throw new Error(`zip_tax_metrics upsert failed: ${error.message}`);
  }
  for (let i = 0; i < boundaryRows.length; i += chunkSize) {
    const chunk = boundaryRows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("zip_boundaries")
      .upsert(chunk, { onConflict: "zip" });
    if (error) throw new Error(`zip_boundaries upsert failed: ${error.message}`);
  }

  console.log(
    `[seed-supabase] upserted ${taxRows.length} tax rows and ${boundaryRows.length} boundary rows`
  );
}

main().catch((err) => {
  console.error("[seed-supabase] failed:", err);
  process.exitCode = 1;
});
