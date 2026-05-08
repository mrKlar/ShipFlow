import { z } from "zod";
import { APPROVAL_ROLES } from "./approval.zod.js";
import { GRILL_ROLES } from "./grill.zod.js";

export const Governance = z.object({
  version: z.literal(1).default(1),
  require_pack_approval: z.boolean().default(false),
  required_approver_roles: z.array(z.enum(APPROVAL_ROLES)).default([]),
  required_grill_roles: z.array(z.enum(GRILL_ROLES)).default([]),
  min_decisions_per_vp: z.number().int().min(0).default(0),
  require_negative_cases: z.boolean().default(false),
  forbid_orphan_decisions: z.boolean().default(false),
  forbid_open_reviews: z.boolean().default(false),
  notes: z.string().optional(),
}).strict();
