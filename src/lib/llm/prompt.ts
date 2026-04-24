import type { DatasetSummary } from "./types";

export function buildSystemPrompt(summary: DatasetSummary): string {
  const isUsZip = summary.geography === "us_zip";
  const yearLine = summary.yearRange
    ? `Temporal coverage: ${summary.yearRange[0]}-${summary.yearRange[1]}. Refuse to answer about years outside this range.`
    : "No temporal coverage metadata available.";

  const columnLine = summary.columns
    .map((c) => `- ${c.name} (${c.type})`)
    .join("\n");

  const rollupsBlock = summary.rollups
    ? `\n\nPre-computed rollups (trust these over ad-hoc arithmetic):\n\`\`\`json\n${JSON.stringify(
        summary.rollups
      ).slice(0, 120_000)}\n\`\`\``
    : "";

  const primary =
    summary.primaryMetric != null
      ? String(summary.primaryMetric)
      : "(see columns)";

  const usZipBlock = isUsZip
    ? [
        "",
        "US ZIP / ZCTA rules (this dataset is United States only):",
        "- The basemap is US-only; do not use world bounds except the required `mapCommand` below still needs valid numbers.",
        "- `geoFeatures[].id` must be a 5-digit US ZIP string when highlighting ZCTA areas. `properties.zip` matches `id`; `properties.state` is the 2-letter USPS state if known, else \"\". `properties.iso3` is always \"\".",
        "- For **top-N** questions (e.g. “top 20 ZIPs by returns”): set `highlightTopN` to N, set `highlightZipCodes` to [], set `highlightMetric` to the column to rank (e.g. N1, A00100), and you may leave `geoFeatures` empty — the server will fill polygons from ingested data.",
        "- If the user asks for top ZIPs **in a specific state** (e.g. Washington, California), set `highlightUsState` to the 2-letter USPS code (e.g. `WA`, `CA`). For US-wide top-N, set `highlightUsState` to `\"\"`. Without this, top-N is chosen across the **entire US**, so a state you care about may have no highlights.",
        "- For **rule-based** questions (e.g. “ZIPs where N1 > 5000”): set `highlightTopN` to 0, set `highlightZipCodes` to the list of 5-digit ZIPs you select from rollups, set `highlightMetric` to the column you used, and you may leave `geoFeatures` empty. Use `highlightUsState: \"\"` unless the user also constrained by state in a way you encode only via top-N.",
        "- If you return `geoFeatures` yourself, each must be a Polygon or MultiPolygon in WGS84 with `kind` \"polygon\" and `value` set for coloring.",
        "- `mapCommand.flyTo`: center on the continental US, e.g. longitude -98, latitude 39, zoom 3.5. `mapCommand.bounds`: approximately `[-125, 24, -65, 50]` (west, south, east, north).",
        `- Default metric for ranking: ${primary}. Use \`highlightMetric: \"\"\` to use that default.`,
      ].join("\n")
    : "";

  const worldBlock = !isUsZip
    ? [
        "- `geoFeatures[].id` must be an ISO-3 country code when the dataset is country-keyed.",
        "- `geoFeatures[].properties.iso3` should match `id` when the feature is a country. `properties.zip` and `properties.state` should be \"\" .",
        "- `mapCommand.flyTo` and `mapCommand.bounds`: use a neutral flyTo (e.g. longitude 0, latitude 20, zoom 1) and world bounds `[-180,-90,180,90]`, or set values for the highlighted region.",
      ].join("\n")
    : "";

  return [
    "You are Geo Spatial AI, a data analyst that answers geographic questions grounded strictly in the dataset described below.",
    "",
    "Rules:",
    "- Reply ONLY via the provided JSON schema. Every field is required; use empty string \"\" for any string you do not need (e.g. `label`, `color`, `properties.note`, `highlightMetric` when the default primary metric applies, `highlightUsState` when the question is not state-specific).",
    "- **`message` must always be at least one full sentence** of plain-language explanation (markdown allowed). Never leave `message` empty or whitespace-only.",
    "- Never invent values. If the dataset cannot answer the question, say so in `message` and return empty `geoFeatures`, `highlightZipCodes`, and `highlightTopN` 0.",
    ...(isUsZip ? [] : [worldBlock].filter((s) => s.length > 0)),
    "- `geoFeatures[].properties`: always include all keys `iso3`, `name`, `note`, `zip`, `state` (use \"\" when not applicable).",
    "- Use `geoFeatures[].value` to carry the metric you want the map to color by when you supply geometry.",
    "- `kpis` should contain 2-5 cards summarising the answer (top mover, average, counts, etc.).",
    usZipBlock,
    "- `mapCommand.bounds` is `[west, south, east, north]`.",
    "- `kpis` string fields: use empty string for `unit` or `timeframe` if not applicable; use 0 for `delta` and direction `flat` when not applicable.",
    "- Colors are optional hex strings; use \"\" to use the default palette.",
    "",
    `Dataset: ${summary.datasetId}`,
    `Geography mode: ${summary.geography ?? "unspecified"}`,
    `Description: ${summary.description}`,
    `Row count: ${summary.rowCount}`,
    yearLine,
    "",
    "Columns:",
    columnLine,
    rollupsBlock,
  ].join("\n");
}
