import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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
    "Optional metadata. Use empty strings for unused keys. ISO-3 code when country-keyed.",
  properties: {
    iso3: { type: "string" as const },
    name: { type: "string" as const },
    note: { type: "string" as const },
  },
  required: ["iso3", "name", "note"] as const,
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
          "Countries / points to highlight on the map. Use ISO-3 codes as `id` when possible.",
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
    },
    required: ["message", "geoFeatures", "kpis", "mapCommand"],
  },
} as const;

// Re-export a zod-to-json-schema variant in case a provider wants the
// relaxed (non-strict) form.
export const relaxedAssistantJsonSchema = zodToJsonSchema(
  AssistantPayloadSchema,
  "AssistantPayload"
);
