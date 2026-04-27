/** Max ZIPs merged from user text + model output in one chat turn (avoids huge queries). */
export const MAX_HIGHLIGHT_ZIP_CODES = 50;

/**
 * US 5-digit sequences in free text (same rule as structured tool context).
 */
export function extractZipCodesFromText(text: string): string[] {
  const matches = text.match(/\b\d{5}\b/g) ?? [];
  return Array.from(new Set(matches));
}
