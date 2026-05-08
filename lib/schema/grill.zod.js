import { z } from "zod";

export const GRILL_ROLES = [
  "general",
  "product",
  "architecture",
  "qa",
  "security",
  "risk",
];

// Internal Zod enum; not exported because no external consumer needs it as a
// standalone type (callers either import GRILL_ROLES for membership checks
// or pass a role through to GrillSession which carries the validation).
const GrillRole = z.enum(GRILL_ROLES);

export const GrillQuestion = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  question: z.string().min(1),
  why_it_matters: z.string().optional(),
  answer: z.string().optional(),
}).strict();

export const GrillFinding = z.object({
  id: z.string().min(1),
  kind: z.enum(["ambiguity", "contradiction", "edge_case", "assumption", "missing_negative_case", "non_goal", "risk"]),
  text: z.string().min(1),
  evidence: z.string().optional(),
  resolution: z.string().optional(),
}).strict();

export const GrillProposedDecision = z.object({
  id: z.string().min(1).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  type: z.enum(["product", "architecture", "ux", "security", "data", "process", "other"]).default("product"),
  title: z.string().min(1),
  question: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().min(1),
  impacts: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
}).strict();

export const GrillSession = z.object({
  id: z.string().min(1),
  intent: z.string().min(1),
  role: GrillRole.default("general"),
  created_at: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  questions: z.array(GrillQuestion).default([]),
  findings: z.array(GrillFinding).default([]),
  proposed_decisions: z.array(GrillProposedDecision).default([]),
  follow_ups: z.array(z.string().min(1)).default([]),
  parent_session: z.string().optional(),
  source_ref: z.string().optional(),
}).strict();
