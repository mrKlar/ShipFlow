import { z } from "zod";
import { CheckState } from "./state-check.zod.js";

const JsonSchema = z.lazy(() => z.object({
  type: z.enum(["object", "array", "string", "number", "boolean", "null"]).optional(),
  required: z.array(z.string()).optional(),
  properties: z.record(JsonSchema).optional(),
  items: JsonSchema.optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict());

export const ApiRequest = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  body_json: z.unknown().optional(),
  auth: z.object({
    kind: z.literal("bearer"),
    env: z.string().optional(),
    token: z.string().optional(),
    header: z.string().default("Authorization"),
    prefix: z.string().default("Bearer "),
  }).strict().optional(),
}).strict();

export const ApiAssert = z.union([
  z.object({ status: z.number().int() }).strict(),
  z.object({ header_equals: z.object({ name: z.string(), equals: z.string() }).strict() }).strict(),
  z.object({ header_matches: z.object({ name: z.string(), matches: z.string().optional(), regex: z.string().optional() }).strict() }).strict(),
  z.object({ header_present: z.object({ name: z.string() }).strict() }).strict(),
  z.object({ header_absent: z.object({ name: z.string() }).strict() }).strict(),
  z.object({ body_contains: z.string() }).strict(),
  z.object({ body_not_contains: z.string() }).strict(),
  z.object({ json_equals: z.object({ path: z.string(), equals: z.unknown() }).strict() }).strict(),
  z.object({ json_matches: z.object({ path: z.string(), matches: z.string().optional(), regex: z.string().optional() }).strict() }).strict(),
  z.object({ json_count: z.object({ path: z.string(), count: z.number().int().nonnegative() }).strict() }).strict(),
  z.object({ json_has: z.object({ path: z.string() }).strict() }).strict(),
  z.object({ json_absent: z.object({ path: z.string() }).strict() }).strict(),
  z.object({ json_type: z.object({ path: z.string(), type: z.enum(["object", "array", "string", "number", "boolean", "null"]) }).strict() }).strict(),
  z.object({ json_array_includes: z.object({ path: z.string(), equals: z.unknown() }).strict() }).strict(),
  z.object({ json_schema: z.object({ path: z.string().default("$"), schema: JsonSchema }).strict() }).strict(),
]);

export const ApiCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  state: CheckState.optional(),
  app: z.object({
    kind: z.literal("api"),
    base_url: z.string(),
  }).strict(),
  request: ApiRequest,
  assert: z.array(ApiAssert),
}).strict();
