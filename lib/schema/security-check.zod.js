import { z } from "zod";
import { ApiRequest } from "./api-check.zod.js";

export const SecurityAssert = z.union([
  z.object({ status: z.number().int() }).strict(),
  z.object({ header_equals: z.object({ name: z.string(), equals: z.string() }).strict() }).strict(),
  z.object({ header_matches: z.object({ name: z.string(), matches: z.string().optional(), regex: z.string().optional() }).strict() }).strict(),
  z.object({ header_absent: z.object({ name: z.string() }).strict() }).strict(),
  z.object({ body_contains: z.string() }).strict(),
  z.object({ body_not_contains: z.string() }).strict(),
]).describe("Security assertions should stay concrete and observable");

export const SecurityCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  category: z.enum([
    "authn",
    "authz",
    "headers",
    "input_validation",
    "cors",
    "session",
    "exposure",
    "rate_limit",
    "other",
  ]).default("other"),
  app: z.object({
    kind: z.literal("security"),
    base_url: z.string(),
  }).strict(),
  request: ApiRequest,
  assert: z.array(SecurityAssert),
}).strict();
