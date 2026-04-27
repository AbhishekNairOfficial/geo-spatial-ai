import type { DataProvider } from "@/lib/data";
import type { DatasetSummary } from "@/lib/llm/types";

function extractZipCodes(message: string): string[] {
  const matches = message.match(/\b\d{5}\b/g) ?? [];
  return Array.from(new Set(matches));
}

function inferTopN(message: string): number | null {
  const m = message.match(/\btop\s+(\d{1,4})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(500, Math.floor(n));
}

function inferMetric(message: string, summary: DatasetSummary): string | undefined {
  const direct = message.match(/\b([A-Za-z]\d{1,8})\b/g) ?? [];
  const upper = direct.map((x) => x.toUpperCase());
  const columns = new Set(summary.columns.map((c) => c.name.toUpperCase()));
  for (const token of upper) {
    if (columns.has(token)) return token;
  }
  if (summary.primaryMetric) return String(summary.primaryMetric);
  return undefined;
}

export async function getStructuredDataContext(args: {
  message: string;
  summary: DatasetSummary;
  dataProvider: DataProvider;
}): Promise<string | null> {
  const { message, summary, dataProvider } = args;
  if (summary.geography !== "us_zip") return null;

  const zips = extractZipCodes(message);
  const topN = inferTopN(message);
  if (zips.length === 0 && !topN) return null;

  const metric = inferMetric(message, summary);
  const data = await dataProvider.query({
    zips: zips.length > 0 ? zips : undefined,
    topN: zips.length === 0 ? topN ?? undefined : undefined,
    metric,
  });

  const rows = data.features.slice(0, 50).map((f) => ({
    zip: f.id,
    value: f.value ?? null,
    label: f.label ?? "",
    state: String((f.properties?.state ?? "") as string),
  }));

  return JSON.stringify(
    {
      metric: metric ?? "",
      requestedZips: zips,
      requestedTopN: topN,
      matchedRows: rows,
      kpis: data.kpis,
    },
    null,
    2
  );
}
