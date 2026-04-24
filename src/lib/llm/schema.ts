import { z } from "zod";

const GeometrySchema = z.object({
  type: z.enum([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
  ]),
  // GeoJSON coordinates: nested number arrays; runtime-validated as GeoJSON later.
  coordinates: z.unknown(),
});

export const KpiSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  delta: z.number().optional(),
  direction: z.enum(["up", "down", "flat"]).optional(),
  timeframe: z.string().optional(),
});

export const GeoFeatureSchema = z.object({
  id: z.string(),
  kind: z.enum(["point", "polygon", "line"]),
  geometry: GeometrySchema,
  label: z.string().optional(),
  color: z.string().optional(),
  value: z.number().optional(),
  properties: z.object({
    iso3: z.string(),
    name: z.string(),
    note: z.string(),
    zip: z.string(),
    state: z.string(),
  }),
});

export const MapCommandSchema = z.object({
  flyTo: z
    .object({
      longitude: z.number(),
      latitude: z.number(),
      zoom: z.number().optional(),
    })
    .optional(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export const AssistantPayloadSchema = z.object({
  message: z.string(),
  geoFeatures: z.array(GeoFeatureSchema),
  kpis: z.array(KpiSchema),
  mapCommand: MapCommandSchema.optional(),
  highlightTopN: z.number().int().min(0).max(10_000),
  highlightZipCodes: z.array(z.string()),
  highlightMetric: z.string(),
  highlightUsState: z.string(),
});

export type AssistantPayloadSchemaType = z.infer<typeof AssistantPayloadSchema>;

/**
 * JSON Schema fed into OpenAI `response_format: { type: "json_schema" }`.
 *
 * OpenAI's strict mode is very picky: every object must list every key in
 * `required`, and `additionalProperties` must be `false`. We hand-roll the
 * schema here instead of relying on `zodToJsonSchema` so it's predictable.
 */
/**
 * GeoJSON `coordinates`: nested arrays of numbers. OpenAI requires every
 * `type: "array"` to have `items`; a bare `array` is rejected (400). We use
 * a recursive `$defs` entry (number | array of same) so Point through
 * MultiPolygon are all valid. Zod still validates structure at parse time.
 */
const geoJsonCoordTree = {
  anyOf: [
    { type: "number" as const },
    {
      type: "array" as const,
      items: { $ref: "#/$defs/geoJsonCoordTree" as const },
    },
  ],
} as const;

const jsonSchemaCoordinates = {
  type: "array" as const,
  items: { $ref: "#/$defs/geoJsonCoordTree" as const },
} as const;

const jsonSchemaGeometry = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    type: {
      type: "string" as const,
      enum: [
        "Point",
        "MultiPoint",
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
      ] as const,
    },
    coordinates: jsonSchemaCoordinates,
  },
  required: ["type", "coordinates"] as const,
} as const;

const jsonSchemaGeoProperties = {
  type: "object" as const,
  additionalProperties: false,
  description:
    "For US ZCTA, set zip to 5 digits and state; leave iso3 empty. For world country data, set iso3 and use empty strings for zip/state.",
  properties: {
    iso3: { type: "string" as const },
    name: { type: "string" as const },
    note: { type: "string" as const },
    zip: { type: "string" as const },
    state: { type: "string" as const },
  },
  required: ["iso3", "name", "note", "zip", "state"] as const,
} as const;

export const assistantResponseJsonSchema = {
  name: "assistant_payload",
  strict: true,
  schema: {
    type: "object",
    $defs: {
      geoJsonCoordTree,
    },
    additionalProperties: false,
    properties: {
      message: {
        type: "string",
        description:
          "Markdown reply shown in the chat panel. Keep to 1-3 sentences unless the user asks for more.",
      },
      geoFeatures: {
        type: "array",
        description:
          "Map highlights. US ZIP: use 5-digit id and polygon/MultiPolygon geometry, or leave empty and use highlightTopN / highlightZipCodes. World: use ISO-3 for id when country-keyed.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["point", "polygon", "line"] },
            geometry: jsonSchemaGeometry,
            label: { type: "string" },
            color: { type: "string" },
            value: { type: "number" },
            properties: jsonSchemaGeoProperties,
          },
          required: [
            "id",
            "kind",
            "geometry",
            "label",
            "color",
            "value",
            "properties",
          ],
        },
      },
      kpis: {
        type: "array",
        description:
          "Numeric KPI cards shown on the right column. 2-5 cards is ideal.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            value: {
              anyOf: [{ type: "number" }, { type: "string" }],
            },
            unit: { type: "string" },
            delta: { type: "number" },
            direction: { type: "string", enum: ["up", "down", "flat"] },
            timeframe: { type: "string" },
          },
          required: [
            "id",
            "label",
            "value",
            "unit",
            "delta",
            "direction",
            "timeframe",
          ],
        },
      },
      mapCommand: {
        type: "object",
        additionalProperties: false,
        properties: {
          flyTo: {
            type: "object",
            additionalProperties: false,
            properties: {
              longitude: { type: "number" },
              latitude: { type: "number" },
              zoom: { type: "number" },
            },
            required: ["longitude", "latitude", "zoom"],
          },
          bounds: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
          },
        },
        required: ["flyTo", "bounds"],
      },
      highlightTopN: {
        type: "integer",
        description:
          "US ZIP: number of top ZIPs to show by highlightMetric (e.g. 20). Use 0 for rule-based lists only (use highlightZipCodes).",
      },
      highlightZipCodes: {
        type: "array",
        items: { type: "string" },
        description:
          "5-digit ZIPs to show when using explicit rule-based selection. Empty if using highlightTopN or raw geoFeatures only.",
      },
      highlightMetric: {
        type: "string",
        description:
          "Column name to rank or color (e.g. N1, A00100). Empty to use the dataset default primary metric.",
      },
      highlightUsState: {
        type: "string",
        description:
          "For US-wide top-N questions, leave \"\". If the user names a state (e.g. Washington, WA), set this to the 2-letter USPS code (e.g. WA) or 2-digit FIPS (e.g. 53) so top-N ZIPs are chosen within that state only. Empty string when not state-scoped.",
      },
    },
    required: [
      "message",
      "geoFeatures",
      "kpis",
      "mapCommand",
      "highlightTopN",
      "highlightZipCodes",
      "highlightMetric",
      "highlightUsState",
    ],
  },
} as const;
