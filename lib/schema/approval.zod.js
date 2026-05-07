import { z } from "zod";

export const APPROVAL_ROLES = [
  "architect",
  "product",
  "qa",
  "security",
  "engineering",
  "other",
];

export const Approval = z.object({
  id: z.string().min(1),
  pack_sha256: z.string().regex(/^[a-f0-9]{64}$/i, { message: "pack_sha256 must be a sha256 hex digest" }),
  approved_by: z.string().min(1),
  approved_at: z.string().min(1),
  role: z.enum(APPROVAL_ROLES).default("architect"),
  scope: z.string().optional(),
  slice: z.string().optional(),
  decision_refs: z.array(z.string().min(1)).default([]),
  grill_refs: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
  revoked_at: z.string().optional(),
  revoked_reason: z.string().optional(),
}).strict();
