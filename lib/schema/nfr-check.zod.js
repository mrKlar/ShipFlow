import { z } from "zod";

export const NfrCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  app: z.object({
    kind: z.literal("nfr"),
    base_url: z.string().url(),
  }).strict(),
  scenario: z.object({
    endpoint: z.string(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    headers: z.record(z.string()).optional(),
    body_json: z.any().optional(),
    thresholds: z.object({
      http_req_duration_p95: z.number().positive().optional(),
      http_req_duration_p99: z.number().positive().optional(),
      http_req_failed: z.number().min(0).max(1).optional(),
    }).strict(),
    vus: z.number().int().positive(),
    duration: z.string().regex(/^\d+[smh]$/),
  }).strict(),
}).strict();
