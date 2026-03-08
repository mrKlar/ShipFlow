import { z } from "zod";

const RepoPath = z.object({ path: z.string() }).strict();
const RepoText = z.object({ path: z.string(), text: z.string() }).strict();
const JsonQuery = z.object({ path: z.string(), query: z.string() }).strict();
const JsonEquals = z.object({ path: z.string(), query: z.string(), equals: z.unknown() }).strict();
const DependencyCheck = z.object({
  name: z.string(),
  section: z.enum(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "all"]).default("all"),
  path: z.string().default("package.json"),
}).strict();
const CommandCheck = z.object({
  command: z.string(),
  cwd: z.string().optional(),
}).strict();
const CommandTextCheck = z.object({
  command: z.string(),
  text: z.string(),
  cwd: z.string().optional(),
}).strict();
const AllowedImportsCheck = z.object({
  files: z.string(),
  patterns: z.array(z.string()).min(1),
  allow_relative: z.boolean().default(true),
}).strict();
const LayerDependencyRule = z.object({
  name: z.string(),
  files: z.string(),
  may_import: z.array(z.string()).default([]),
}).strict();
const LayerDependenciesCheck = z.object({
  layers: z.array(LayerDependencyRule).min(2),
  allow_external: z.boolean().default(true),
  allow_unmatched_relative: z.boolean().default(false),
  allow_same_layer: z.boolean().default(true),
}).strict();

export const TechnicalAssert = z.union([
  z.object({ path_exists: RepoPath }).strict(),
  z.object({ path_absent: RepoPath }).strict(),
  z.object({ file_contains: RepoText }).strict(),
  z.object({ file_not_contains: RepoText }).strict(),
  z.object({ json_has: JsonQuery }).strict(),
  z.object({ json_equals: JsonEquals }).strict(),
  z.object({ dependency_present: DependencyCheck }).strict(),
  z.object({ dependency_absent: DependencyCheck }).strict(),
  z.object({ github_action_uses: z.object({ workflow: z.string(), action: z.string() }).strict() }).strict(),
  z.object({ glob_count: z.object({ glob: z.string(), equals: z.number().int().nonnegative() }).strict() }).strict(),
  z.object({ imports_forbidden: z.object({ files: z.string(), patterns: z.array(z.string()).min(1) }).strict() }).strict(),
  z.object({ imports_allowed_only_from: AllowedImportsCheck }).strict(),
  z.object({ layer_dependencies: LayerDependenciesCheck }).strict(),
  z.object({ command_succeeds: CommandCheck }).strict(),
  z.object({ command_stdout_contains: CommandTextCheck }).strict(),
  z.object({ command_stdout_not_contains: CommandTextCheck }).strict(),
]);

export const TechnicalCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  category: z.enum([
    "framework",
    "architecture",
    "infrastructure",
    "saas",
    "ci",
    "testing",
    "mobile",
    "web",
    "other",
  ]).default("other"),
  runner: z.object({
    kind: z.enum(["custom", "archtest"]).default("custom"),
    framework: z.enum(["custom", "dependency-cruiser", "madge", "tsarch", "eslint-plugin-boundaries", "archtest"]).optional(),
  }).strict().optional(),
  app: z.object({
    kind: z.literal("technical"),
    root: z.string().default("."),
  }).strict(),
  assert: z.array(TechnicalAssert).min(1),
}).strict();
