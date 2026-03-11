import { z } from "zod";

export const CheckState = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sqlite"),
    connection: z.string().min(1),
    reset_sql: z.string().min(1),
  }).strict(),
]);
