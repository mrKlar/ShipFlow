import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { UiCheck, UiFixture } from "./schema/ui-check.zod.js";
import { BehaviorCheck } from "./schema/behavior-check.zod.js";
import { ApiCheck } from "./schema/api-check.zod.js";
import { DbCheck } from "./schema/db-check.zod.js";
import { DomainCheck } from "./schema/domain-check.zod.js";
import { NfrCheck } from "./schema/nfr-check.zod.js";
import { SecurityCheck } from "./schema/security-check.zod.js";
import { TechnicalCheck } from "./schema/technical-check.zod.js";
import { buildMap } from "./map.js";

function addIssue(issues, level, code, file, message) {
  issues.push({ level, code, file, message });
}

function listYaml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => path.join(dir, f));
}

function rel(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

function loadYaml(file, issues, cwd) {
  try {
    return yaml.load(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    addIssue(issues, "error", "yaml.parse_error", rel(cwd, file), String(err.message || err));
    return null;
  }
}

function parseWithSchema(schema, file, raw, issues, cwd) {
  try {
    const parsed = schema.parse(raw);
    parsed.__file = rel(cwd, file);
    return parsed;
  } catch (err) {
    if (err instanceof z.ZodError) {
      for (const issue of err.issues) {
        addIssue(
          issues,
          "error",
          "schema.invalid",
          rel(cwd, file),
          `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        );
      }
    } else {
      addIssue(issues, "error", "schema.invalid", rel(cwd, file), String(err.message || err));
    }
    return null;
  }
}

function hasStrongUiAssert(asserts) {
  return asserts.some(a => a.text_equals || a.text_matches || a.url_matches || a.count);
}

function hasStrongApiAssert(asserts) {
  return asserts.some(a =>
    a.header_equals ||
    a.header_matches ||
    a.header_present ||
    a.header_absent ||
    a.body_contains ||
    a.body_not_contains ||
    a.json_equals ||
    a.json_matches ||
    a.json_count ||
    a.json_has ||
    a.json_absent ||
    a.json_type ||
    a.json_array_includes ||
    a.json_schema
  );
}

function hasStrongTuiAssert(asserts) {
  return asserts.some(a =>
    a.stdout_contains ||
    a.stdout_not_contains ||
    a.stderr_contains ||
    a.stderr_not_contains
  );
}

function locatorKinds(steps) {
  const kinds = new Set();
  for (const step of steps) {
    const action = step.click || step.fill || step.select || step.hover;
    if (!action) continue;
    if (action.testid) kinds.add("testid");
    if (action.label) kinds.add("label");
    if (action.role || action.name) kinds.add("role");
  }
  return kinds;
}

function lintUiCheck(check, issues) {
  if (check.assert.length === 0) {
    addIssue(issues, "error", "ui.missing_assert", check.__file, "UI checks should have at least one assertion.");
  }
  if (check.flow.length > 8) {
    addIssue(issues, "warn", "ui.long_flow", check.__file, "UI flow is long; split into more focused checks or use a fixture.");
  }
  if (!hasStrongUiAssert(check.assert)) {
    addIssue(issues, "warn", "ui.weak_asserts", check.__file, "UI check relies only on visibility/hidden asserts; add stronger observable assertions.");
  }
  if (check.flow.filter(step => step.open).length > 1) {
    addIssue(issues, "warn", "ui.multiple_open", check.__file, "Multiple open steps often indicate more than one behavior in the same check.");
  }
  if (check.flow.length > 0) {
    const kinds = locatorKinds(check.flow);
    if (kinds.has("role") && !kinds.has("testid") && !kinds.has("label")) {
      addIssue(issues, "warn", "ui.locator_stability", check.__file, "Flow uses only role/name locators; prefer testid or label for stability where possible.");
    }
  }
}

function lintBehaviorCheck(check, issues) {
  if (check.then.length === 0) {
    addIssue(issues, "error", "behavior.missing_then", check.__file, "Behavior checks should have at least one Then assertion.");
  }
  if (check.given.length === 0) {
    addIssue(issues, "warn", "behavior.missing_given", check.__file, "Behavior check has no Given steps.");
  }
  if (check.when.length === 0) {
    addIssue(issues, "warn", "behavior.missing_when", check.__file, "Behavior check has no When steps.");
  }
  if (check.app.kind === "web" && !hasStrongUiAssert(check.then)) {
    addIssue(issues, "warn", "behavior.weak_then", check.__file, "Web behavior checks should assert a concrete observable UI outcome.");
  }
  if (check.app.kind === "api" && !hasStrongApiAssert(check.then)) {
    addIssue(issues, "warn", "behavior.weak_then", check.__file, "API behavior checks should assert more than status alone.");
  }
  if (check.app.kind === "tui" && !hasStrongTuiAssert(check.then)) {
    addIssue(issues, "warn", "behavior.weak_then", check.__file, "TUI behavior checks should assert concrete stdout or stderr output.");
  }
}

function lintApiLikeCheck(check, issues, kind) {
  const hasStatus = check.assert.some(a => a.status !== undefined);
  const hasConcrete = check.assert.some(a =>
    a.header_equals ||
    a.header_matches ||
    a.header_present ||
    a.header_absent ||
    a.body_contains ||
    a.body_not_contains ||
    a.json_equals ||
    a.json_matches ||
    a.json_count ||
    a.json_has ||
    a.json_absent ||
    a.json_type ||
    a.json_array_includes ||
    a.json_schema
  );
  if (!hasStatus) {
    addIssue(issues, "error", `${kind}.missing_status`, check.__file, `${kind} checks should include an HTTP status assertion.`);
  }
  if (!hasConcrete) {
    addIssue(issues, "warn", `${kind}.weak_asserts`, check.__file, `${kind} check should include concrete body/header assertions, not only status.`);
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(check.request.method) && check.assert.length < 2) {
    addIssue(issues, "warn", `${kind}.mutation_coverage`, check.__file, `${kind} mutation checks should verify more than one outcome.`);
  }
}

function lintDbCheck(check, issues) {
  if (check.assert.length === 0) {
    addIssue(issues, "error", "db.missing_assert", check.__file, "DB checks should have at least one assertion.");
  }
  if (!check.setup_sql && !check.seed_sql && !check.before_query) {
    addIssue(issues, "warn", "db.no_setup", check.__file, "DB check has no setup_sql; make sure its state is deterministic.");
  }
  if (check.action_sql && !check.cleanup_sql) {
    addIssue(issues, "warn", "db.no_cleanup", check.__file, "DB mutation checks should usually define cleanup_sql for isolation.");
  }
  if (check.before_query && (!check.before_assert || check.before_assert.length === 0)) {
    addIssue(issues, "warn", "db.before_without_assert", check.__file, "before_query is present without before_assert.");
  }
  if (check.after_query && (!check.after_assert || check.after_assert.length === 0)) {
    addIssue(issues, "warn", "db.after_without_assert", check.__file, "after_query is present without after_assert.");
  }
}

function lintDomainCheck(check, issues) {
  const attributeNames = new Set(check.attributes.map(item => item.name));
  const referenceNames = new Set((check.references || []).map(item => item.name));
  const knownFields = new Set([...attributeNames, ...referenceNames]);

  for (const field of check.identity.fields) {
    if (!attributeNames.has(field)) {
      addIssue(issues, "error", "domain.identity_unknown_field", check.__file, `Identity field "${field}" must also appear in attributes.`);
    }
  }

  if (!check.data_engineering.storage && !check.data_engineering.exchange) {
    addIssue(issues, "error", "domain.data_engineering_missing", check.__file, "Business-domain checks must include a data-engineering section for storage, exchange, or both.");
  }

  if ((check.access_patterns.reads || []).length === 0 && (check.access_patterns.writes || []).length === 0) {
    addIssue(issues, "warn", "domain.access_patterns_missing", check.__file, "Business-domain checks should name at least one read or write access pattern.");
  }

  const verifyFields = (items, codePrefix, label) => {
    for (const item of items || []) {
      for (const field of item.fields || []) {
        if (!knownFields.has(field)) {
          addIssue(issues, "error", `${codePrefix}.unknown_field`, check.__file, `${label} "${item.name}" references unknown field "${field}".`);
        }
      }
    }
  };

  verifyFields(check.access_patterns.reads, "domain.read_pattern", "Read pattern");
  verifyFields(check.access_patterns.writes, "domain.write_pattern", "Write pattern");
  verifyFields(check.data_engineering.storage?.read_models, "domain.read_model", "Read model");
  verifyFields(check.data_engineering.storage?.write_models, "domain.write_model", "Write model");
  verifyFields(check.data_engineering.exchange?.inbound, "domain.exchange_inbound", "Inbound exchange model");
  verifyFields(check.data_engineering.exchange?.outbound, "domain.exchange_outbound", "Outbound exchange model");
}

function lintNfrCheck(check, issues) {
  if (Object.keys(check.scenario.thresholds).length === 0) {
    addIssue(issues, "error", "nfr.missing_thresholds", check.__file, "NFR checks should define at least one threshold.");
  }
  if (check.scenario.profile === "smoke" && !check.scenario.ramp_up && !check.scenario.stages && check.scenario.vus && check.scenario.vus > 20) {
    addIssue(issues, "warn", "nfr.smoke_high_vus", check.__file, "Smoke performance checks should usually stay lightweight.");
  }
  if (check.scenario.duration && check.scenario.duration.endsWith("s")) {
    const seconds = parseInt(check.scenario.duration.slice(0, -1), 10);
    if (seconds < 10) {
      addIssue(issues, "warn", "nfr.short_duration", check.__file, "Very short duration may be too noisy to trust as a performance signal.");
    }
  }
  if (check.scenario.stages && check.scenario.stages.length < 2 && check.scenario.profile && check.scenario.profile !== "smoke") {
    addIssue(issues, "warn", "nfr.weak_stages", check.__file, "Load/stress profiles usually benefit from multiple stages.");
  }
}

function lintFixture(fixture, issues) {
  if (fixture.flow.length === 0) {
    addIssue(issues, "warn", "fixture.empty", fixture.__file, "Fixture flow is empty.");
  }
}

function lintTechnicalCheck(check, issues) {
  if (check.assert.length === 0) {
    addIssue(issues, "error", "technical.missing_assert", check.__file, "Technical checks should have at least one assertion.");
  }

  const hasArchitectureRule = check.assert.some(a => a.imports_forbidden || a.imports_allowed_only_from || a.layer_dependencies || a.no_circular_dependencies || a.glob_count || a.glob_count_gte);
  const hasCiRule = check.assert.some(a => a.github_action_uses || (a.path_exists && a.path_exists.path.startsWith(".github/workflows/")) || (a.file_contains && a.file_contains.path.startsWith(".github/workflows/")));
  const hasFrameworkRule = check.assert.some(
    a => a.dependency_present
      || a.dependency_absent
      || a.dependency_version_matches
      || a.json_equals
      || a.json_has
      || a.json_matches
      || a.script_present
      || a.script_contains
      || a.graphql_surface_present
      || a.graphql_surface_absent
      || a.rest_api_present
      || a.rest_api_absent
  );
  const hasCommandRule = check.assert.some(a => a.command_succeeds || a.command_stdout_contains || a.command_stdout_not_contains);

  if (check.runner?.kind === "archtest" && !hasArchitectureRule) {
    addIssue(issues, "warn", "technical.archtest_without_arch_rule", check.__file, "Architecture runner selected but no architecture-oriented assertion was found.");
  }
  if (check.runner?.framework && check.runner.framework !== "custom" && !hasCommandRule && !hasArchitectureRule) {
    addIssue(issues, "warn", "technical.framework_not_exercised", check.__file, "A technical framework is declared but no command-based or architecture assertion exercises it.");
  }
  if (check.category === "architecture" && !hasArchitectureRule) {
    addIssue(issues, "warn", "technical.weak_architecture", check.__file, "Architecture checks should usually include imports_forbidden, imports_allowed_only_from, layer_dependencies, no_circular_dependencies, or glob_count assertions.");
  }
  if (check.category === "ci" && !hasCiRule) {
    addIssue(issues, "warn", "technical.weak_ci", check.__file, "CI checks should usually target workflow files or actions explicitly.");
  }
  if (check.category === "framework" && !hasFrameworkRule) {
    addIssue(issues, "warn", "technical.weak_framework", check.__file, "Framework checks should usually assert dependencies or manifest values.");
  }
}

function coverageTypeForCheck(check) {
  if ("object" in check && "data_engineering" in check) return "domain";
  if (check.app?.kind === "web" && "flow" in check) return "ui";
  if ("given" in check && "when" in check && "then" in check) return "behavior";
  if (check.app?.kind === "api" && "request" in check) return "api";
  if (check.app?.kind === "db") return "database";
  if (check.app?.kind === "nfr") return "performance";
  if (check.app?.kind === "security") return "security";
  if (check.app?.kind === "technical") return "technical";
  return null;
}

function formatHuman(result) {
  const lines = [];
  lines.push(`Verification Pack lint: ${result.ok ? "OK" : "FAILED"}`);
  lines.push(`Errors: ${result.summary.errors}, warnings: ${result.summary.warnings}`);
  if (result.issues.length > 0) {
    lines.push("");
    for (const issue of result.issues) {
      lines.push(`[${issue.level}] ${issue.file} ${issue.code}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export function runLint(cwd) {
  const vpDir = path.join(cwd, "vp");
  const issues = [];
  const checks = [];
  const fixtures = [];

  const parseFiles = (subdir, schema, collection) => {
    for (const file of listYaml(path.join(vpDir, subdir))) {
      const raw = loadYaml(file, issues, cwd);
      if (raw === null) continue;
      const parsed = parseWithSchema(schema, file, raw, issues, cwd);
      if (parsed) collection.push(parsed);
    }
  };

  parseFiles("ui", UiCheck, checks);
  parseFiles("behavior", BehaviorCheck, checks);
  parseFiles("domain", DomainCheck, checks);
  parseFiles("api", ApiCheck, checks);
  parseFiles("db", DbCheck, checks);
  parseFiles("nfr", NfrCheck, checks);
  parseFiles("security", SecurityCheck, checks);
  parseFiles("technical", TechnicalCheck, checks);
  parseFiles(path.join("ui", "_fixtures"), UiFixture, fixtures);

  const idToFiles = new Map();
  for (const item of [...checks, ...fixtures]) {
    const bucket = idToFiles.get(item.id) || [];
    bucket.push(item.__file);
    idToFiles.set(item.id, bucket);
  }
  for (const [id, files] of idToFiles) {
    if (files.length > 1) {
      for (const file of files) {
        addIssue(issues, "error", "vp.duplicate_id", file, `Duplicate VP id "${id}" also appears in: ${files.filter(f => f !== file).join(", ")}`);
      }
    }
  }

  for (const check of checks) {
    if ("object" in check && "data_engineering" in check) {
      lintDomainCheck(check, issues);
      continue;
    }
    if (check.app?.kind === "web" && "flow" in check) lintUiCheck(check, issues);
    if ("given" in check && "when" in check && "then" in check) lintBehaviorCheck(check, issues);
    if (check.app?.kind === "api" && "request" in check) lintApiLikeCheck(check, issues, "api");
    if (check.app?.kind === "db") lintDbCheck(check, issues);
    if (check.app?.kind === "nfr") lintNfrCheck(check, issues);
    if (check.app?.kind === "security") lintApiLikeCheck(check, issues, "security");
    if (check.app?.kind === "technical") lintTechnicalCheck(check, issues);
  }

  for (const fixture of fixtures) lintFixture(fixture, issues);

  const parsedCoverage = {
    ui: 0,
    behavior: 0,
    domain: 0,
    api: 0,
    database: 0,
    performance: 0,
    security: 0,
    technical: 0,
  };
  for (const check of checks) {
    const type = coverageTypeForCheck(check);
    if (!type) continue;
    parsedCoverage[type] += 1;
  }

  const mapResult = buildMap(cwd);
  const requiredBundleTypes = mapResult.project?.verification_bundle?.required_types || [];
  const missingBundleTypes = requiredBundleTypes.filter(type => parsedCoverage[type] === 0);
  if (mapResult.project?.app_archetype && missingBundleTypes.length > 0) {
    addIssue(
      issues,
      "warn",
      "vp.archetype_bundle_missing",
      "vp/",
      `Detected app archetype "${mapResult.project.app_archetype}" but the pack is missing baseline coverage for: ${missingBundleTypes.join(", ")}.`,
    );
  }

  const summary = {
    errors: issues.filter(i => i.level === "error").length,
    warnings: issues.filter(i => i.level === "warn").length,
  };
  return {
    ok: summary.errors === 0,
    issues,
    summary,
  };
}

export function lint({ cwd, json = false }) {
  const result = runLint(cwd);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result));
  }
  return { exitCode: result.ok ? 0 : 1, result };
}
