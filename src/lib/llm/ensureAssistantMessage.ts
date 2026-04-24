import type { AssistantPayload } from "./types";

/**
 * Some models occasionally return an empty `message` while still filling KPIs /
 * highlights. The chat UI would show "(no response)"; provide a short default.
 */
export function ensureAssistantMessage(payload: AssistantPayload): AssistantPayload {
  if (payload.message?.trim()) return payload;

  const metric =
    payload.highlightMetric?.trim() || "the selected metric";
  if ((payload.highlightTopN ?? 0) > 0) {
    const st = payload.highlightUsState?.trim();
    const where = st
      ? ` in **${st.toUpperCase()}** (US state)`
      : " (US-wide)";
    return {
      ...payload,
      message: `Showing the top ${payload.highlightTopN} ZIPs by **${metric}**${where} on the map. See KPIs for summary stats.`,
    };
  }
  if (payload.highlightZipCodes?.length) {
    return {
      ...payload,
      message: `Highlighting **${payload.highlightZipCodes.length}** ZIP code(s) you asked for. Details are on the map and in the KPIs.`,
    };
  }
  if (payload.geoFeatures.length > 0) {
    return {
      ...payload,
      message: `Mapped **${payload.geoFeatures.length}** area(s). Check the KPIs for the main numbers.`,
    };
  }
  return {
    ...payload,
    message:
      "I could not produce a text summary for this request; see KPIs and the map if data is available.",
  };
}
