import { z } from "zod";

const DomainFieldName = z.string().min(1);

const DomainAttribute = z.object({
  name: DomainFieldName,
  type: z.string().min(1),
  required: z.boolean().default(false),
  mutable: z.boolean().default(true),
  values: z.array(z.string()).optional(),
  description: z.string().optional(),
}).strict();

const DomainReference = z.object({
  name: DomainFieldName,
  target: z.string().min(1),
  cardinality: z.enum(["one", "many", "optional-one", "optional-many"]).default("one"),
  required: z.boolean().default(false),
  description: z.string().optional(),
}).strict();

const DomainShape = z.object({
  name: z.string().min(1),
  fields: z.array(DomainFieldName).min(1),
  description: z.string().optional(),
}).strict();

const DomainDataEngineering = z.object({
  storage: z.object({
    canonical_model: z.string().min(1),
    allow_denormalized_copies: z.boolean().default(true),
    write_models: z.array(DomainShape).default([]),
    read_models: z.array(DomainShape).default([]),
  }).strict().optional(),
  exchange: z.object({
    inbound: z.array(DomainShape).default([]),
    outbound: z.array(DomainShape).default([]),
  }).strict().optional(),
  guidance: z.array(z.string()).default([]),
}).strict();

export const DomainAssert = z.union([
  z.object({
    data_engineering_present: z.object({
      sections: z.array(z.enum(["storage", "exchange"])).min(1),
    }).strict(),
  }).strict(),
  z.object({
    read_model_defined: z.object({
      name: z.string().min(1),
    }).strict(),
  }).strict(),
  z.object({
    write_model_defined: z.object({
      name: z.string().min(1),
    }).strict(),
  }).strict(),
  z.object({
    exchange_model_defined: z.object({
      direction: z.enum(["inbound", "outbound"]),
      name: z.string().min(1),
    }).strict(),
  }).strict(),
  z.object({
    reference_defined: z.object({
      name: z.string().min(1),
      target: z.string().min(1).optional(),
    }).strict(),
  }).strict(),
]);

export const DomainCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["blocker", "warn"]),
  object: z.object({
    name: z.string().min(1),
    kind: z.enum(["entity", "aggregate", "value_object", "event"]).default("entity"),
  }).strict(),
  description: z.string().optional(),
  identity: z.object({
    fields: z.array(DomainFieldName).min(1),
    strategy: z.enum(["natural", "surrogate", "composite"]).default("surrogate"),
  }).strict(),
  attributes: z.array(DomainAttribute).min(1),
  references: z.array(DomainReference).default([]),
  invariants: z.array(z.string().min(1)).min(1),
  access_patterns: z.object({
    reads: z.array(DomainShape).default([]),
    writes: z.array(DomainShape).default([]),
  }).strict(),
  data_engineering: DomainDataEngineering,
  assert: z.array(DomainAssert).min(1),
}).strict();
