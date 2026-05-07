import { z } from "zod";

export const DECISION_TYPES = [
  "product",
  "architecture",
  "ux",
  "security",
  "data",
  "process",
  "other",
];

export const DECISION_STATUSES = [
  "proposed",
  "accepted",
  "superseded",
  "rejected",
];

export const DECISION_SOURCES = [
  "grill",
  "review",
  "incident",
  "client-feedback",
  "manual",
  "discovery",
];

export const Decision = z.object({
  id: z.string().min(1).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: "id must be kebab-case (lowercase letters, digits, dashes)",
  }),
  type: z.enum(DECISION_TYPES).default("product"),
  status: z.enum(DECISION_STATUSES).default("accepted"),
  title: z.string().min(1),
  question: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().min(1),
  source: z.enum(DECISION_SOURCES).default("manual"),
  source_ref: z.string().optional(),
  impacts: z.array(z.string().min(1)).default([]),
  supersedes: z.string().optional(),
  superseded_by: z.string().optional(),
  decided_by: z.string().optional(),
  decided_at: z.string().optional(),
  notes: z.string().optional(),
}).strict();
