import { z } from "zod";
import { FlowStep, Assert } from "./ui-check.zod.js";
import { ApiRequest, ApiAssert } from "./api-check.zod.js";
import { CheckState } from "./state-check.zod.js";

const ExampleValue = z.union([z.string(), z.number(), z.boolean()]);
const BehaviorRunner = z.object({
  kind: z.enum(["playwright", "gherkin"]).default("playwright"),
  framework: z.enum(["playwright", "cucumber"]).optional(),
}).strict();

const BehaviorExecutor = z.object({
  kind: z.enum(["browser", "api", "pty"]).optional(),
  framework: z.enum(["playwright", "playwright-request", "node"]).optional(),
}).strict();

const WaitStep = z.object({
  wait_for: z.object({ ms: z.number().int().positive().optional() }).strict(),
}).strict();

const ApiBehaviorStep = z.union([
  z.object({ request: ApiRequest }).strict(),
  WaitStep,
]);

const TuiStep = z.union([
  z.object({
    stdin: z.object({
      text: z.string(),
      delay_ms: z.number().int().nonnegative().optional(),
    }).strict(),
  }).strict(),
  WaitStep,
  z.object({
    signal: z.object({
      name: z.enum(["SIGINT", "SIGTERM", "SIGKILL"]).default("SIGINT"),
    }).strict(),
  }).strict(),
]);

const TuiAssert = z.union([
  z.object({ stdout_contains: z.string() }).strict(),
  z.object({ stdout_not_contains: z.string() }).strict(),
  z.object({ stderr_contains: z.string() }).strict(),
  z.object({ stderr_not_contains: z.string() }).strict(),
  z.object({ exit_code: z.number().int() }).strict(),
]);

const BehaviorBase = {
  id: z.string(),
  feature: z.string(),
  scenario: z.string(),
  severity: z.enum(["blocker", "warn"]),
  tags: z.array(z.string()).optional(),
  runner: BehaviorRunner.optional(),
  executor: BehaviorExecutor.optional(),
  examples: z.array(z.record(ExampleValue)).optional(),
  state: CheckState.optional(),
};

const WebBehaviorCheck = z.object({
  ...BehaviorBase,
  setup: z.string().optional(),
  app: z.object({
    kind: z.literal("web"),
    base_url: z.string(),
  }).strict(),
  given: z.array(FlowStep),
  when: z.array(FlowStep),
  then: z.array(Assert),
}).strict();

const ApiBehaviorCheck = z.object({
  ...BehaviorBase,
  app: z.object({
    kind: z.literal("api"),
    base_url: z.string(),
  }).strict(),
  given: z.array(ApiBehaviorStep),
  when: z.array(ApiBehaviorStep),
  then: z.array(ApiAssert),
}).strict();

const TuiBehaviorCheck = z.object({
  ...BehaviorBase,
  app: z.object({
    kind: z.literal("tui"),
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
  }).strict(),
  given: z.array(TuiStep),
  when: z.array(TuiStep),
  then: z.array(TuiAssert),
}).strict();

function validateBehaviorExecutor(check, ctx) {
  if (!check.executor) return;

  const expected = {
    web: { kind: "browser", frameworks: ["playwright"] },
    api: { kind: "api", frameworks: ["playwright-request"] },
    tui: { kind: "pty", frameworks: ["node"] },
  }[check.app.kind];

  if (check.executor.kind && check.executor.kind !== expected.kind) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["executor", "kind"],
      message: `Behavior app.kind "${check.app.kind}" requires executor.kind "${expected.kind}".`,
    });
  }

  if (check.executor.framework && !expected.frameworks.includes(check.executor.framework)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["executor", "framework"],
      message: `Behavior app.kind "${check.app.kind}" requires one of: ${expected.frameworks.join(", ")}.`,
    });
  }
}

export const BehaviorCheck = z.union([
  WebBehaviorCheck,
  ApiBehaviorCheck,
  TuiBehaviorCheck,
]).superRefine(validateBehaviorExecutor);
