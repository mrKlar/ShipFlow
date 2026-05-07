import { z } from "zod";

export const DISCOVERY_KINDS = [
  "ui_route",
  "api_endpoint",
  "graphql_endpoint",
  "db_table",
  "auth_surface",
  "security_surface",
  "technical_surface",
];

export const DiscoveryProposal = z.object({
  kind: z.enum(DISCOVERY_KINDS),
  target: z.string().min(1),
  title: z.string().min(1),
  suggested_path: z.string().min(1),
  rationale: z.string().min(1),
  evidence: z.array(z.string().min(1)).default([]),
}).strict();

export const DiscoverySession = z.object({
  id: z.string().min(1),
  created_at: z.string().min(1),
  app_archetype: z.string().nullable().optional(),
  proposals: z.array(DiscoveryProposal).default([]),
  notes: z.string().optional(),
  by_kind: z.record(z.number()).optional(),
}).strict();
