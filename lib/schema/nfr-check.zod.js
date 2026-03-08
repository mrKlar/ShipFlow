import { z } from "zod";

const Duration = z.string().regex(/^\d+[smh]$/);

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
    profile: z.enum(["smoke", "load", "stress", "spike"]).optional(),
    thresholds: z.object({
      http_req_duration_avg: z.number().positive().optional(),
      http_req_duration_p90: z.number().positive().optional(),
      http_req_duration_p95: z.number().positive().optional(),
      http_req_duration_p99: z.number().positive().optional(),
      http_req_failed: z.number().min(0).max(1).optional(),
      checks_rate: z.number().min(0).max(1).optional(),
    }).strict(),
    vus: z.number().int().positive().optional(),
    duration: Duration.optional(),
    ramp_up: Duration.optional(),
    graceful_ramp_down: Duration.optional(),
    stages: z.array(z.object({
      duration: Duration,
      target: z.number().int().nonnegative(),
    }).strict()).optional(),
    expected_status: z.number().int().optional().default(200),
  }).strict().refine(
    scenario => (Array.isArray(scenario.stages) && scenario.stages.length > 0) || (scenario.vus && scenario.duration),
    {
      message: "scenario requires either stages or vus + duration",
      path: ["stages"],
    },
  ),
}).strict();
