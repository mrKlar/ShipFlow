import { z } from "zod";

const roleFields = {
  role: z.string(),
  name: z.string(),
  name_regex: z.boolean().optional(),
};
const testidField = { testid: z.string() };
const labelField = { label: z.string() };

function makeLocator(extra = {}, roleDefault) {
  const rf = { ...roleFields, ...extra };
  if (roleDefault !== undefined) rf.role = z.string().default(roleDefault);
  return z.union([
    z.object(rf).strict(),
    z.object({ ...testidField, ...extra }).strict(),
    z.object({ ...labelField, ...extra }).strict(),
  ]);
}

const valueField = { value: z.string() };

const FlowStep = z.union([
  z.object({ open: z.string() }).strict(),
  z.object({ click: makeLocator({}, "button") }).strict(),
  z.object({ fill: makeLocator(valueField) }).strict(),
  z.object({ select: makeLocator(valueField) }).strict(),
  z.object({ hover: makeLocator() }).strict(),
  z.object({ wait_for: z.object({ ms: z.number().int().positive().optional() }).strict() }).strict(),
]);

const Assert = z.union([
  z.object({ text_equals: z.object({ testid: z.string(), equals: z.string() }).strict() }).strict(),
  z.object({ text_matches: z.object({ testid: z.string(), regex: z.string() }).strict() }).strict(),
  z.object({ visible: z.object({ testid: z.string() }).strict() }).strict(),
  z.object({ hidden: z.object({ testid: z.string() }).strict() }).strict(),
  z.object({ url_matches: z.object({ regex: z.string() }).strict() }).strict(),
  z.object({ count: z.object({ testid: z.string(), equals: z.number().int().nonnegative() }).strict() }).strict(),
]);

export const UiCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  setup: z.string().optional(),
  app: z.object({
    kind: z.literal("web"),
    base_url: z.string(),
  }).strict(),
  flow: z.array(FlowStep),
  assert: z.array(Assert),
}).strict();

export const UiFixture = z.object({
  id: z.string(),
  title: z.string().optional(),
  app: z.object({
    kind: z.literal("web"),
    base_url: z.string(),
  }).strict(),
  flow: z.array(FlowStep),
}).strict();
