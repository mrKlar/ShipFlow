import { z } from "zod";

export const UiCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  app: z.object({
    kind: z.literal("web"),
    base_url: z.string()
  }).strict(),
  flow: z.array(z.union([
    z.object({ open: z.string() }).strict(),
    z.object({ click: z.object({ role: z.string().default("button"), name: z.string(), name_regex: z.boolean().optional() }).strict() }).strict(),
    z.object({ wait_for: z.object({ ms: z.number().int().positive().optional() }).strict() }).strict()
  ])),
  assert: z.array(z.union([
    z.object({ text_equals: z.object({ testid: z.string(), equals: z.string() }).strict() }).strict(),
    z.object({ text_matches: z.object({ testid: z.string(), regex: z.string() }).strict() }).strict()
  ]))
}).strict();
