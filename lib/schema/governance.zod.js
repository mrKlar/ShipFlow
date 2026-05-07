import { z } from "zod";

export const APPROVER_ROLES = [
  "architect",
  "product",
  "qa",
  "security",
  "engineering",
  "other",
];

export const GRILL_ROLES = [
  "general",
  "product",
  "architecture",
  "qa",
  "security",
  "risk",
];

export const Governance = z.object({
  version: z.literal(1).default(1),
  require_pack_approval: z.boolean().default(false),
  required_approver_roles: z.array(z.enum(APPROVER_ROLES)).default([]),
  required_grill_roles: z.array(z.enum(GRILL_ROLES)).default([]),
  min_decisions_per_vp: z.number().int().min(0).default(0),
  require_negative_cases: z.boolean().default(false),
  forbid_orphan_decisions: z.boolean().default(false),
  forbid_open_reviews: z.boolean().default(false),
  notes: z.string().optional(),
}).strict();
