/**
 * US state/territory → 2-digit FIPS (as used in IRS / rollups `state` field).
 * @see https://www.census.gov/library/reference/code-lists/ansi.html
 */
const USPS_TO_FIPS: Record<string, string> = {
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
  DE: "10",
  DC: "11",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
};

const FIPS_TO_USPS: Record<string, string> = Object.fromEntries(
  Object.entries(USPS_TO_FIPS).map(([abbr, fips]) => [fips, abbr])
);

/** 2-digit FIPS → USPS (e.g. `53` → `WA`). */
export function fipsToUsps(fips: string): string | undefined {
  const k = fips.trim().padStart(2, "0");
  return FIPS_TO_USPS[k];
}

/**
 * Normalize a user/LLM state token to 2-digit FIPS for matching rollup `state`.
 * Accepts USPS abbreviations (e.g. `WA`, `ny`) or numeric FIPS (`53`, `09`).
 */
export function normalizeUsStateToFips(input: string | undefined): string | undefined {
  if (!input?.trim()) return undefined;
  const t = input.trim();
  if (/^\d{1,2}$/.test(t)) return t.padStart(2, "0");
  const u = t.toUpperCase();
  if (u.length === 2 && USPS_TO_FIPS[u]) return USPS_TO_FIPS[u];
  return undefined;
}
