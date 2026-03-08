import { z } from "zod";

export const DbAssert = z.union([
  z.object({ row_count: z.number().int().nonnegative() }).strict(),
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
  setup_sql: z.string().optional(),
  query: z.string(),
  assert: z.array(DbAssert),
}).strict();
