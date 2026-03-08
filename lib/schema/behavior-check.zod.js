import { z } from "zod";
import { FlowStep, Assert } from "./ui-check.zod.js";

export const BehaviorCheck = z.object({
  id: z.string(),
  feature: z.string(),
  scenario: z.string(),
  severity: z.enum(["blocker", "warn"]),
  setup: z.string().optional(),
  app: z.object({
    kind: z.literal("web"),
    base_url: z.string(),
  }).strict(),
  given: z.array(FlowStep),
  when: z.array(FlowStep),
  then: z.array(Assert),
}).strict();
