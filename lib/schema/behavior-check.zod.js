import { z } from "zod";
import { FlowStep, Assert } from "./ui-check.zod.js";

const ExampleValue = z.union([z.string(), z.number(), z.boolean()]);
const BehaviorRunner = z.object({
  kind: z.enum(["playwright", "gherkin"]).default("playwright"),
  framework: z.enum(["playwright", "cucumber"]).optional(),
}).strict();

export const BehaviorCheck = z.object({
  id: z.string(),
  feature: z.string(),
  scenario: z.string(),
  severity: z.enum(["blocker", "warn"]),
  tags: z.array(z.string()).optional(),
  runner: BehaviorRunner.optional(),
  setup: z.string().optional(),
  app: z.object({
    kind: z.literal("web"),
    base_url: z.string(),
  }).strict(),
  given: z.array(FlowStep),
  when: z.array(FlowStep),
  then: z.array(Assert),
  examples: z.array(z.record(ExampleValue)).optional(),
}).strict();
