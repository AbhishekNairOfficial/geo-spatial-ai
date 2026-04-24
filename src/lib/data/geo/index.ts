import nameToIso3Map from "./country-name-to-iso3.json";

const map = nameToIso3Map as Record<string, string>;

/**
 * Normalize a raw country name/code (from a CSV or user input) to its ISO-3 code.
 * Returns null if we can't find a match.
 */
export function nameToIso3(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();

  if (trimmed.length === 3 && trimmed.toUpperCase() === trimmed) {
    if (Object.values(map).includes(trimmed)) {
      return trimmed;
    }
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return map[normalized] ?? null;
}

export type CountryFeatureProperties = {
  iso3: string;
  name: string;
};
