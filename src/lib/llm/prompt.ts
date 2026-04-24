import type { DatasetSummary } from "./types";

export function buildSystemPrompt(summary: DatasetSummary): string {
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

  return [
    "You are Geo Spatial AI, a data analyst that answers geographic questions grounded strictly in the dataset described below.",
    "",
    "Rules:",
    "- Reply ONLY via the provided JSON schema. Every field is required; use empty string \"\" for any optional string you do not need (e.g. `label`, `color`, or `properties.iso3` / `properties.name` / `properties.note`).",
    "- Never invent values. If the dataset cannot answer the question, say so in `message` and return empty `geoFeatures` and `kpis`.",
    "- `geoFeatures[].id` must be an ISO-3 country code when the dataset is country-keyed.",
    "- `geoFeatures[].properties.iso3` should match `id` when the feature is a country. Otherwise use \"\" .",
    "- Use `geoFeatures[].value` to carry the metric you want the map to color by.",
    "- `kpis` should contain 2-5 cards summarising the answer (top mover, average, count improved/declined, etc.).",
    "- `mapCommand.flyTo` and `mapCommand.bounds`: use a neutral flyTo (e.g. longitude 0, latitude 20, zoom 1) and a world bounds `[-180,-90,180,90]` if no specific zoom is needed, or set sensible values for the highlighted region.",
    "- `mapCommand.bounds` is `[west, south, east, north]`.",
    "- `kpis` string fields: use empty string for `unit` or `timeframe` if not applicable; use 0 for `delta` and direction `flat` when not applicable.",
    "- Colors are optional hex strings; use \"\" to use the default palette.",
    "",
    `Dataset: ${summary.datasetId}`,
    `Description: ${summary.description}`,
    `Row count: ${summary.rowCount}`,
    yearLine,
    "",
    "Columns:",
    columnLine,
    rollupsBlock,
  ].join("\n");
}
