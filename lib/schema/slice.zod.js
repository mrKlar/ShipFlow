import { z } from "zod";

export const SLICE_STATUSES = [
  "proposed",
  "planned",
  "in-progress",
  "implemented",
  "verified",
  "shipped",
  "abandoned",
];

export const Slice = z.object({
  id: z.string().min(1).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: "id must be kebab-case",
  }),
  goal: z.string().min(1),
  intent: z.string().optional(),
  status: z.enum(SLICE_STATUSES).default("proposed"),
  vp: z.array(z.string().min(1)).default([]),
  decisions: z.array(z.string().min(1)).default([]),
  grill_refs: z.array(z.string().min(1)).default([]),
  evidence: z.array(z.string().min(1)).default([]),
  reviewer: z.string().optional(),
  notes: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).strict();
