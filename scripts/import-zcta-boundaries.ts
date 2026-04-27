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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const sourcePath = process.env.ZCTA_GEOJSON_PATH
    ? path.resolve(process.env.ZCTA_GEOJSON_PATH)
    : path.join(root, "public", "data", "kaggle", "features.geojson");

  const raw = await fs.readFile(sourcePath, "utf8");
  const fc = JSON.parse(raw) as FeatureCollection;
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = fc.features
    .map((f) => {
      if (!f.geometry) return null;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const zip = String(props.zip ?? f.id ?? "").trim();
      if (!zip) return null;
      const centroid = centroidFromGeometry(f.geometry);
      return {
        zip,
        state_fips: typeof props.state === "string" ? props.state : null,
        name: typeof props.name === "string" ? props.name : null,
        geometry_geojson: f.geometry,
        centroid_lat: centroid?.lat ?? null,
        centroid_lng: centroid?.lng ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const chunkSize = Number(process.env.ZCTA_UPSERT_CHUNK_SIZE || "100");
  const maxAttempts = Number(process.env.ZCTA_UPSERT_MAX_ATTEMPTS || "5");
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { error } = await supabase
          .from("zip_boundaries")
          .upsert(chunk, { onConflict: "zip" });
        if (error) throw new Error(error.message);
        inserted += chunk.length;
        if ((i / chunkSize + 1) % 20 === 0 || i + chunkSize >= rows.length) {
          console.log(
            `[import-zcta-boundaries] progress ${inserted}/${rows.length} (chunk ${Math.floor(
              i / chunkSize
            ) + 1})`
          );
        }
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (attempt === maxAttempts) break;
        const delay = attempt * 1000;
        console.warn(
          `[import-zcta-boundaries] chunk ${Math.floor(i / chunkSize) + 1} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`,
          err instanceof Error ? err.message : String(err)
        );
        await sleep(delay);
      }
    }
    if (lastError) {
      throw new Error(
        `zip_boundaries upsert failed after ${maxAttempts} attempts at chunk ${Math.floor(i / chunkSize) + 1}: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`
      );
    }
  }

  console.log(
    `[import-zcta-boundaries] upserted ${rows.length} boundaries from ${sourcePath}`
  );
}

main().catch((err) => {
  console.error("[import-zcta-boundaries] failed:", err);
  process.exitCode = 1;
});
