import { z } from "zod";

export const DbAssert = z.union([
  z.object({ row_count: z.number().int().nonnegative() }).strict(),
  z.object({ row_count_gte: z.number().int().nonnegative() }).strict(),
  z.object({ row_count_lte: z.number().int().nonnegative() }).strict(),
  z.object({ cell_equals: z.object({
    row: z.number().int().nonnegative(),
    column: z.string(),
    equals: z.string(),
  }).strict() }).strict(),
  z.object({ cell_matches: z.object({
    row: z.number().int().nonnegative(),
    column: z.string(),
    matches: z.string(),
  }).strict() }).strict(),
  z.object({ column_contains: z.object({
    column: z.string(),
    value: z.string(),
  }).strict() }).strict(),
  z.object({ column_not_contains: z.object({
    column: z.string(),
    value: z.string(),
  }).strict() }).strict(),
  z.object({ row_equals: z.object({
    row: z.number().int().nonnegative(),
    equals: z.record(z.unknown()),
  }).strict() }).strict(),
  z.object({ result_equals: z.array(z.record(z.unknown())) }).strict(),
]);

export const DbCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  app: z.object({
    kind: z.literal("db"),
    engine: z.enum(["sqlite", "postgresql"]),
    connection: z.string(),
  }).strict(),
  seed_sql: z.string().optional(),
  setup_sql: z.string().optional(),
  before_query: z.string().optional(),
  before_assert: z.array(DbAssert).optional(),
  action_sql: z.string().optional(),
  query: z.string(),
  assert: z.array(DbAssert),
  after_query: z.string().optional(),
  after_assert: z.array(DbAssert).optional(),
  cleanup_sql: z.string().optional(),
}).strict();
