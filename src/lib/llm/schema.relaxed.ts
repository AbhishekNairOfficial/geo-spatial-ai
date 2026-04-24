import { zodToJsonSchema } from "zod-to-json-schema";
import { AssistantPayloadSchema } from "./schema";

/** Optional Zod→JSON-Schema export for providers; chat uses `assistantResponseJsonSchema`. */
export const relaxedAssistantJsonSchema = zodToJsonSchema(
  AssistantPayloadSchema,
  "AssistantPayload"
);
