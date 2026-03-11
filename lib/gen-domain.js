import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { DomainCheck } from "./schema/domain-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(issue => `  ${issue.path.join(".")}: ${issue.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readDomainChecks(vpDir) {
  const dir = path.join(vpDir, "domain");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(file => file.endsWith(".yml") || file.endsWith(".yaml"));
  return files.map(file => {
    const full = path.join(dir, file);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = DomainCheck.parse(raw);
      parsed.__file = `vp/domain/${file}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/domain/${file}`, err);
      throw err;
    }
  });
}

function domainBaseName(check) {
  return check.__file.replaceAll("/", "_").replace(/\.ya?ml$/, "");
}

export function genDomainRunner(check) {
  return [
    "#!/usr/bin/env node",
    "// ShipFlow business-domain backend",
    "",
    `const check = ${JSON.stringify(check, null, 2)};`,
    "let failures = 0;",
    "",
    "function assertCondition(condition, message) {",
    "  if (condition) return;",
    "  failures += 1;",
    "  console.error(`FAIL ${message}`);",
    "}",
    "",
    "function names(items) {",
    "  return new Set((items || []).map(item => item.name));",
    "}",
    "",
    "function assertFieldSet(label, knownFields, fields) {",
    "  for (const field of fields || []) {",
    "    assertCondition(knownFields.has(field), `${label} references unknown field ${field}`);",
    "  }",
    "}",
    "",
    "const attributeNames = names(check.attributes);",
    "const referenceNames = names(check.references);",
    "const knownFields = new Set([...attributeNames, ...referenceNames]);",
    "const readModelNames = names(check.data_engineering?.storage?.read_models);",
    "const writeModelNames = names(check.data_engineering?.storage?.write_models);",
    "const inboundNames = names(check.data_engineering?.exchange?.inbound);",
    "const outboundNames = names(check.data_engineering?.exchange?.outbound);",
    "",
    "for (const field of check.identity.fields || []) {",
    "  assertCondition(attributeNames.has(field), `identity field ${field} must appear in attributes`);",
    "}",
    "",
    "for (const pattern of check.access_patterns?.reads || []) {",
    "  assertFieldSet(`read access pattern ${pattern.name}`, knownFields, pattern.fields);",
    "}",
    "for (const pattern of check.access_patterns?.writes || []) {",
    "  assertFieldSet(`write access pattern ${pattern.name}`, knownFields, pattern.fields);",
    "}",
    "for (const model of check.data_engineering?.storage?.read_models || []) {",
    "  assertFieldSet(`read model ${model.name}`, knownFields, model.fields);",
    "}",
    "for (const model of check.data_engineering?.storage?.write_models || []) {",
    "  assertFieldSet(`write model ${model.name}`, knownFields, model.fields);",
    "}",
    "for (const model of check.data_engineering?.exchange?.inbound || []) {",
    "  assertFieldSet(`exchange inbound model ${model.name}`, knownFields, model.fields);",
    "}",
    "for (const model of check.data_engineering?.exchange?.outbound || []) {",
    "  assertFieldSet(`exchange outbound model ${model.name}`, knownFields, model.fields);",
    "}",
    "",
    "for (const assertion of check.assert || []) {",
    "  if (assertion.data_engineering_present) {",
    "    for (const section of assertion.data_engineering_present.sections) {",
    "      assertCondition(Boolean(check.data_engineering?.[section]), `data engineering section ${section} must be defined`);",
    "    }",
    "  }",
    "  if (assertion.read_model_defined) {",
    "    assertCondition(readModelNames.has(assertion.read_model_defined.name), `read model ${assertion.read_model_defined.name} must be defined`);",
    "  }",
    "  if (assertion.write_model_defined) {",
    "    assertCondition(writeModelNames.has(assertion.write_model_defined.name), `write model ${assertion.write_model_defined.name} must be defined`);",
    "  }",
    "  if (assertion.exchange_model_defined) {",
    "    const namesForDirection = assertion.exchange_model_defined.direction === 'inbound' ? inboundNames : outboundNames;",
    "    assertCondition(namesForDirection.has(assertion.exchange_model_defined.name), `${assertion.exchange_model_defined.direction} exchange model ${assertion.exchange_model_defined.name} must be defined`);",
    "  }",
    "  if (assertion.reference_defined) {",
    "    const reference = (check.references || []).find(item => item.name === assertion.reference_defined.name);",
    "    assertCondition(Boolean(reference), `reference ${assertion.reference_defined.name} must be defined`);",
    "    if (reference && assertion.reference_defined.target) {",
    "      assertCondition(reference.target === assertion.reference_defined.target, `reference ${assertion.reference_defined.name} must target ${assertion.reference_defined.target}`);",
    "    }",
    "  }",
    "}",
    "",
    "if (failures > 0) process.exit(1);",
    "console.log(`ShipFlow business-domain backend: ${check.object.name} contract is consistent.`);",
    "",
  ].join("\n");
}

export function genDomainArtifacts(check) {
  return [{
    name: `${domainBaseName(check)}.runner.mjs`,
    kind: "domain-runner",
    primary: true,
    content: genDomainRunner(check),
  }];
}
