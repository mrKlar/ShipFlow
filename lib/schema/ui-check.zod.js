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
const TargetRef = z.string();

const SizeRange = z.object({
  min_px: z.number().nonnegative().optional(),
  max_px: z.number().nonnegative().optional(),
}).strict().refine(value => value.min_px !== undefined || value.max_px !== undefined, {
  message: "size range requires min_px or max_px",
});

const VisualContext = z.object({
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict().optional(),
  color_scheme: z.enum(["light", "dark"]).optional(),
  reduced_motion: z.boolean().default(true),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  device_scale_factor: z.number().positive().optional(),
  wait_for_fonts: z.boolean().default(true),
  mask: z.array(makeLocator()).optional(),
}).strict();

const VisualAssertion = z.union([
  z.object({
    aligned: z.object({
      items: z.array(TargetRef).min(2),
      axis: z.enum(["left", "right", "top", "bottom", "center-x", "center-y"]),
      tolerance_px: z.number().nonnegative().default(4),
    }).strict(),
  }).strict(),
  z.object({
    spacing: z.object({
      from: TargetRef,
      to: TargetRef,
      axis: z.enum(["x", "y"]),
      min_px: z.number().nonnegative(),
      max_px: z.number().nonnegative(),
    }).strict(),
  }).strict(),
  z.object({
    size_range: z.object({
      target: TargetRef,
      width: SizeRange.optional(),
      height: SizeRange.optional(),
    }).strict().refine(value => value.width || value.height, {
      message: "size_range requires width or height constraints",
    }),
  }).strict(),
  z.object({
    inside: z.object({
      inner: TargetRef,
      outer: TargetRef,
      tolerance_px: z.number().nonnegative().default(0),
    }).strict(),
  }).strict(),
  z.object({
    not_overlapping: z.object({
      a: TargetRef,
      b: TargetRef,
      tolerance_px: z.number().nonnegative().default(0),
    }).strict(),
  }).strict(),
  z.object({
    css_equals: z.object({
      target: TargetRef,
      property: z.string(),
      equals: z.string(),
    }).strict(),
  }).strict(),
  z.object({
    css_matches: z.object({
      target: TargetRef,
      property: z.string(),
      regex: z.string(),
    }).strict(),
  }).strict(),
  z.object({
    token_resolves: z.object({
      target: TargetRef,
      property: z.string(),
      token: z.string(),
    }).strict(),
  }).strict(),
]);

const VisualSnapshot = z.object({
  name: z.string(),
  target: TargetRef.optional(),
  full_page: z.boolean().default(false),
  max_diff_ratio: z.number().min(0).max(1).default(0),
  max_diff_pixels: z.number().int().nonnegative().optional(),
  per_pixel_threshold: z.number().min(0).max(1).default(0.1),
}).strict().superRefine((value, ctx) => {
  if (!value.target && !value.full_page) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["target"],
      message: "snapshot requires target unless full_page is true",
    });
  }
});

const VisualSpec = z.object({
  context: VisualContext,
  assertions: z.array(VisualAssertion).optional(),
  snapshots: z.array(VisualSnapshot).optional(),
}).strict().refine(
  value => (value.assertions?.length || 0) > 0 || (value.snapshots?.length || 0) > 0,
  { message: "visual requires at least one assertion or snapshot" },
);

export const FlowStep = z.union([
  z.object({ open: z.string() }).strict(),
  z.object({ click: makeLocator({}, "button") }).strict(),
  z.object({ fill: makeLocator(valueField) }).strict(),
  z.object({ select: makeLocator(valueField) }).strict(),
  z.object({ hover: makeLocator() }).strict(),
  z.object({ wait_for: z.object({ ms: z.number().int().positive().optional() }).strict() }).strict(),
  z.object({ route_block: z.object({
    path: z.string(),
    status: z.number().int().min(100).max(599).default(500),
  }).strict() }).strict(),
]);

export const Assert = z.union([
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
  targets: z.record(makeLocator()).optional(),
  assert: z.array(Assert),
  visual: VisualSpec.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.visual && (!value.targets || Object.keys(value.targets).length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targets"],
      message: "visual checks require named targets",
    });
  }
});

export const UiFixture = z.object({
  id: z.string(),
  title: z.string().optional(),
  app: z.object({
    kind: z.literal("web"),
    base_url: z.string(),
  }).strict(),
  flow: z.array(FlowStep),
}).strict();
