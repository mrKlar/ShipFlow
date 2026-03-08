import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { UiCheck, UiFixture } from "./schema/ui-check.zod.js";
import { BehaviorCheck } from "./schema/behavior-check.zod.js";
import { ApiCheck } from "./schema/api-check.zod.js";
import { DbCheck } from "./schema/db-check.zod.js";
import { NfrCheck } from "./schema/nfr-check.zod.js";
import { SecurityCheck } from "./schema/security-check.zod.js";

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
  if (!hasStrongUiAssert(check.then)) {
    addIssue(issues, "warn", "behavior.weak_then", check.__file, "Behavior check should assert a concrete observable outcome.");
  }
}

function lintApiLikeCheck(check, issues, kind) {
  const hasStatus = check.assert.some(a => a.status !== undefined);
  const hasConcrete = check.assert.some(a => a.header_equals || a.header_matches || a.body_contains || a.json_equals || a.json_matches || a.json_count || a.header_absent || a.body_not_contains);
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
  if (!check.setup_sql) {
    addIssue(issues, "warn", "db.no_setup", check.__file, "DB check has no setup_sql; make sure its state is deterministic.");
  }
}

function lintNfrCheck(check, issues) {
  if (Object.keys(check.scenario.thresholds).length === 0) {
    addIssue(issues, "error", "nfr.missing_thresholds", check.__file, "NFR checks should define at least one threshold.");
  }
  if (check.scenario.duration.endsWith("s")) {
    const seconds = parseInt(check.scenario.duration.slice(0, -1), 10);
    if (seconds < 10) {
      addIssue(issues, "warn", "nfr.short_duration", check.__file, "Very short duration may be too noisy to trust as a performance signal.");
    }
  }
}

function lintFixture(fixture, issues) {
  if (fixture.flow.length === 0) {
    addIssue(issues, "warn", "fixture.empty", fixture.__file, "Fixture flow is empty.");
  }
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
  parseFiles("api", ApiCheck, checks);
  parseFiles("db", DbCheck, checks);
  parseFiles("nfr", NfrCheck, checks);
  parseFiles("security", SecurityCheck, checks);
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
    if (check.app.kind === "web" && "flow" in check) lintUiCheck(check, issues);
    if (check.app.kind === "web" && "given" in check) lintBehaviorCheck(check, issues);
    if (check.app.kind === "api") lintApiLikeCheck(check, issues, "api");
    if (check.app.kind === "db") lintDbCheck(check, issues);
    if (check.app.kind === "nfr") lintNfrCheck(check, issues);
    if (check.app.kind === "security") lintApiLikeCheck(check, issues, "security");
  }

  for (const fixture of fixtures) lintFixture(fixture, issues);

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
