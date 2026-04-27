import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { parse as parseCsv } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

type Row = Record<string, string>;

type MetricEntry = {
  earliest: number | null;
  latest: number | null;
  delta: number | null;
  min: number;
  max: number;
  mean: number;
};

type ImportOutputRow = {
  zip: string;
  state_fips: string | null;
  name: string;
  earliest_year: number;
  latest_year: number;
  metrics: Record<string, MetricEntry>;
  source: string;
  source_url: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const root = process.cwd();
const envFile = path.join(root, ".env");
const envLocal = path.join(root, ".env.local");
if (existsSync(envFile)) loadEnv({ path: envFile });
if (existsSync(envLocal)) loadEnv({ path: envLocal, override: true });

function detectZipColumn(headers: string[]): string | null {
  const patterns = [/^zipcode$/i, /^zip$/i, /^zip_code$/i, /^zcta5?$/i];
  for (const h of headers) {
    if (patterns.some((p) => p.test(h.trim()))) return h;
  }
  for (const h of headers) {
    if (/zip/i.test(h)) return h;
  }
  return null;
}

function detectStateColumn(headers: string[]): string | null {
  const candidates = [/^statefips$/i, /^state$/i, /^st$/i];
  for (const h of headers) {
    if (candidates.some((p) => p.test(h.trim()))) return h;
  }
  return null;
}

function normalizeZip5(raw: string | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  const z = d.length >= 5 ? d.slice(-5) : d.padStart(5, "0");
  if (z === "00000" || z === "99999") return null;
  return z;
}

function toNum(v: string | undefined): number | null {
  if (v == null) return null;
  const t = String(v).replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function detectNumericColumns(rows: Row[], skip: Set<string>): string[] {
  const headers = Object.keys(rows[0] ?? {});
  return headers.filter((h) => {
    if (skip.has(h)) return false;
    const sample = rows
      .slice(0, 200)
      .map((r) => r[h])
      .filter((v) => v != null && String(v).trim() !== "");
    if (sample.length === 0) return false;
    const numericShare =
      sample.filter((v) => toNum(v) !== null).length / sample.length;
    return numericShare >= 0.9;
  });
}

async function readSourceCsv(): Promise<string> {
  const csvPath = process.env.IRS_SOI_CSV_PATH?.trim();
  const csvUrl = process.env.IRS_SOI_CSV_URL?.trim();
  if (csvPath) {
    return fs.readFile(path.resolve(csvPath), "utf8");
  }
  if (csvUrl) {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`Failed to download IRS CSV: ${res.status}`);
    return res.text();
  }
  throw new Error("Set IRS_SOI_CSV_PATH or IRS_SOI_CSV_URL.");
}

function inferYearFromFilename(filePath: string): number | null {
  const base = path.basename(filePath);
  const m = base.match(/^(\d{2})zp.*\.csv$/i);
  if (!m) return null;
  const yy = Number(m[1]);
  if (!Number.isFinite(yy)) return null;
  return 2000 + yy;
}

async function discoverBatchFiles(): Promise<Array<{ filePath: string; year: number }>> {
  const dir = process.env.IRS_SOI_BATCH_DIR?.trim();
  if (!dir) return [];
  const names = await fs.readdir(path.resolve(dir));
  const out: Array<{ filePath: string; year: number }> = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    const year = inferYearFromFilename(name);
    if (!year) continue;
    out.push({ filePath: path.join(path.resolve(dir), name), year });
  }
  out.sort((a, b) => a.year - b.year);
  return out;
}

function buildUpsertsForRows(args: {
  rows: Row[];
  taxYear: number;
  sourceUrl: string;
}): ImportOutputRow[] {
  const { rows, taxYear, sourceUrl } = args;
  const headers = Object.keys(rows[0] ?? {});
  const zipCol = detectZipColumn(headers);
  if (!zipCol) throw new Error("Could not detect ZIP column in IRS CSV.");
  const stateCol = detectStateColumn(headers);

  const skip = new Set<string>([
    zipCol,
    ...(stateCol ? [stateCol] : []),
    "agi_stub",
    "agi class",
    "AGI_STUB",
  ]);
  const metrics = detectNumericColumns(rows, skip);
  if (metrics.length === 0) {
    throw new Error("No numeric metric columns detected for aggregation.");
  }

  const sumsByZip = new Map<
    string,
    { state: string; metrics: Record<string, number> }
  >();
  for (const row of rows) {
    const zip = normalizeZip5(row[zipCol]);
    if (!zip) continue;
    const state = stateCol ? String(row[stateCol] ?? "").trim() : "";
    if (!sumsByZip.has(zip)) {
      sumsByZip.set(zip, { state, metrics: {} });
    }
    const agg = sumsByZip.get(zip)!;
    if (!agg.state && state) agg.state = state;
    for (const m of metrics) {
      const v = toNum(row[m]);
      if (v === null) continue;
      agg.metrics[m] = (agg.metrics[m] ?? 0) + v;
    }
  }

  return Array.from(sumsByZip.entries()).map(([zip, agg]) => {
    const metricEntries: Record<string, MetricEntry> = {};
    for (const [k, v] of Object.entries(agg.metrics)) {
      const n = Number(v.toFixed(3));
      metricEntries[k] = {
        earliest: n,
        latest: n,
        delta: 0,
        min: n,
        max: n,
        mean: n,
      };
    }
    return {
      zip,
      state_fips: agg.state || null,
      name: agg.state ? `${agg.state} ${zip}` : `ZIP ${zip}`,
      earliest_year: taxYear,
      latest_year: taxYear,
      metrics: metricEntries,
      source: `irs_soi_${taxYear}`,
      source_url: sourceUrl,
    };
  });
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const defaultSourceUrl =
    process.env.IRS_SOI_SOURCE_URL ||
    "https://www.irs.gov/statistics/soi-tax-stats-individual-income-tax-statistics-2022-zip-code-data-soi";
  const batchFiles = await discoverBatchFiles();
  const jobs: Array<{ label: string; upserts: ImportOutputRow[] }> = [];
  if (batchFiles.length > 0) {
    for (const file of batchFiles) {
      const csvText = await fs.readFile(file.filePath, "utf8");
      const rows = parseCsv(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Row[];
      if (rows.length === 0) continue;
      jobs.push({
        label: `${file.year}:${path.basename(file.filePath)}`,
        upserts: buildUpsertsForRows({
          rows,
          taxYear: file.year,
          sourceUrl: defaultSourceUrl,
        }),
      });
    }
  } else {
    const csvText = await readSourceCsv();
    const rows = parseCsv(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Row[];
    if (rows.length === 0) throw new Error("CSV had no rows.");
    const taxYear = Number(process.env.IRS_SOI_TAX_YEAR || "2022");
    jobs.push({
      label: String(taxYear),
      upserts: buildUpsertsForRows({
        rows,
        taxYear,
        sourceUrl: defaultSourceUrl,
      }),
    });
  }
  if (jobs.length === 0) {
    throw new Error("No IRS CSV files found. Set IRS_SOI_BATCH_DIR or IRS_SOI_CSV_PATH.");
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const chunkSize = Number(process.env.IRS_SOI_UPSERT_CHUNK_SIZE || "100");
  const maxAttempts = Number(process.env.IRS_SOI_UPSERT_MAX_ATTEMPTS || "5");
  let insertedTotal = 0;
  for (const job of jobs) {
    const upserts = job.upserts;
    let inserted = 0;
    console.log(
      `[import-irs-soi-csv] importing ${job.label} (${upserts.length} ZIP rows)`
    );
    for (let i = 0; i < upserts.length; i += chunkSize) {
      const chunk = upserts.slice(i, i + chunkSize);
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const { error } = await supabase
            .from("zip_tax_metrics")
            .upsert(chunk, { onConflict: "zip,earliest_year" });
          if (error) throw new Error(error.message);
          inserted += chunk.length;
          insertedTotal += chunk.length;
          if ((i / chunkSize + 1) % 20 === 0 || i + chunkSize >= upserts.length) {
            console.log(
              `[import-irs-soi-csv] ${job.label} progress ${inserted}/${upserts.length} (chunk ${Math.floor(
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
            `[import-irs-soi-csv] ${job.label} chunk ${Math.floor(i / chunkSize) + 1} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`,
            err instanceof Error ? err.message : String(err)
          );
          await sleep(delay);
        }
      }
      if (lastError) {
        throw new Error(
          `Supabase upsert failed after ${maxAttempts} attempts at ${job.label} chunk ${
            Math.floor(i / chunkSize) + 1
          }: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        );
      }
    }
  }

  console.log(
    `[import-irs-soi-csv] completed. Upserted ${insertedTotal} ZIP-year rows across ${jobs.length} file(s).`
  );
}

main().catch((err) => {
  console.error("[import-irs-soi-csv] failed:", err);
  process.exitCode = 1;
});
