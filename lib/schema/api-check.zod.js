import { z } from "zod";

const ApiRequest = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  body_json: z.unknown().optional(),
}).strict();

export const ApiAssert = z.union([
  z.object({ status: z.number().int() }).strict(),
  z.object({ header_equals: z.object({ name: z.string(), equals: z.string() }).strict() }).strict(),
  z.object({ header_matches: z.object({ name: z.string(), matches: z.string().optional(), regex: z.string().optional() }).strict() }).strict(),
  z.object({ body_contains: z.string() }).strict(),
  z.object({ json_equals: z.object({ path: z.string(), equals: z.unknown() }).strict() }).strict(),
  z.object({ json_matches: z.object({ path: z.string(), matches: z.string().optional(), regex: z.string().optional() }).strict() }).strict(),
  z.object({ json_count: z.object({ path: z.string(), count: z.number().int().nonnegative() }).strict() }).strict(),
]);

export const ApiCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  app: z.object({
    kind: z.literal("api"),
    base_url: z.string(),
  }).strict(),
  request: ApiRequest,
  assert: z.array(ApiAssert),
}).strict();
