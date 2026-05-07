import { z } from "zod";

export const REVIEW_KINDS = [
  "concern",
  "change_request",
  "approval",
  "question",
];

export const REVIEW_STATUSES = [
  "open",
  "resolved",
  "wont_fix",
  "obsolete",
];

export const REVIEW_TARGET_KINDS = [
  "vp",
  "slice",
  "evidence",
  "screenshot",
  "api_sample",
  "decision",
  "grill",
];

export const ArtifactReview = z.object({
  id: z.string().min(1),
  target_kind: z.enum(REVIEW_TARGET_KINDS),
  target: z.string().min(1),
  kind: z.enum(REVIEW_KINDS).default("concern"),
  status: z.enum(REVIEW_STATUSES).default("open"),
  text: z.string().min(1),
  reviewer: z.string().min(1),
  slice: z.string().optional(),
  decision_ref: z.string().optional(),
  follow_up: z.array(z.string().min(1)).default([]),
  created_at: z.string().min(1),
  resolved_at: z.string().optional(),
  resolved_by: z.string().optional(),
  resolution_notes: z.string().optional(),
}).strict();
