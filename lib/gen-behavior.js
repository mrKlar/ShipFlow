import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { BehaviorCheck } from "./schema/behavior-check.zod.js";
import { genStep, assertConditionExpr, assertExpr, hasInteractiveUiFlow } from "./gen-ui.js";
import { apiAssertExpr, apiAssertConditionExpr, buildMutantApiRequests } from "./gen-api.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readBehaviorChecks(vpDir) {
  const dir = path.join(vpDir, "behavior");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = BehaviorCheck.parse(raw);
      parsed.__file = `vp/behavior/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/behavior/${f}`, err);
      throw err;
    }
  });
}

export function isGherkinBehavior(check) {
  return check?.runner?.kind === "gherkin" || check?.runner?.framework === "cucumber";
}

export function resolveBehaviorExecutor(check) {
  if (check?.executor?.kind || check?.executor?.framework) {
    return {
      kind: check.executor.kind || defaultBehaviorExecutor(check).kind,
      framework: check.executor.framework || defaultBehaviorExecutor(check).framework,
    };
  }
  return defaultBehaviorExecutor(check);
}

function defaultBehaviorExecutor(check) {
  if (check?.app?.kind === "api") {
    return { kind: "api", framework: "playwright-request" };
  }
  if (check?.app?.kind === "tui") {
    return { kind: "pty", framework: "node" };
  }
  return { kind: "browser", framework: "playwright" };
}

export function genBehaviorTest(check, fixturesMap) {
  if (check.app.kind === "api") return genApiBehaviorTest(check);
  if (check.app.kind === "tui") return genTuiBehaviorTest(check);
  return genWebBehaviorTest(check, fixturesMap);
}

function genWebBehaviorTest(check, fixturesMap) {
  const baseUrl = check.app.base_url;
  const L = [];
  const examples = Array.isArray(check.examples) && check.examples.length > 0 ? check.examples : [null];
  const executor = resolveBehaviorExecutor(check);
  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`test.describe(${JSON.stringify(check.feature)}, () => {`);
  if (check.tags?.length) {
    L.push(`  // tags: ${check.tags.join(", ")}`);
  }
  L.push(`  // executor: ${executor.kind}/${executor.framework}`);
  for (const [index, example] of examples.entries()) {
    const resolvedScenario = substituteTemplate(check.scenario, example);
    const title = example ? `${check.id}[${index + 1}]: ${resolvedScenario}` : `${check.id}: ${resolvedScenario}`;
    L.push(`  test(${JSON.stringify(title)}, async ({ page }) => {`);
    if (example) {
      L.push(`    // example: ${JSON.stringify(example)}`);
    }
    L.push(`    await page.goto(${JSON.stringify(baseUrl)});`);

    if (check.setup) {
      const fixture = fixturesMap?.get(check.setup);
      if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
      L.push(`    // setup: ${check.setup}`);
      for (const step of fixture.flow) {
        L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
      }
    }

    L.push(`    // Given`);
    for (const step of check.given) {
      L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
    }
    L.push(`    // When`);
    for (const step of check.when) {
      L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
    }
    L.push(`    // Then`);
    for (const a of check.then) {
      L.push(`    ${assertExpr(applyTemplate(a, example))}`);
    }
    L.push(`  });`);

    const mutationGuardConditions = hasInteractiveUiFlow(check.when)
      ? check.then.map(assertion => assertConditionExpr(applyTemplate(assertion, example))).filter(Boolean)
      : [];
    if (mutationGuardConditions.length > 0) {
      const guardTitle = example ? `${check.id}[${index + 1}]: ${resolvedScenario} [mutation guard]` : `${check.id}: ${resolvedScenario} [mutation guard]`;
      L.push(`  test(${JSON.stringify(guardTitle)}, async ({ page }) => {`);
      if (example) {
        L.push(`    // example: ${JSON.stringify(example)}`);
      }
      L.push(`    await page.goto(${JSON.stringify(baseUrl)});`);

      if (check.setup) {
        const fixture = fixturesMap?.get(check.setup);
        if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
        L.push(`    // setup: ${check.setup}`);
        for (const step of fixture.flow) {
          L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
        }
      }

      L.push(`    // Given`);
      for (const step of check.given) {
        L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
      }
      L.push(`    const mutationGuardPasses = [`);
      for (const condition of mutationGuardConditions) {
        L.push(`      ${condition},`);
      }
      L.push(`    ].every(Boolean);`);
      L.push(`    expect(mutationGuardPasses).toBe(false);`);
      L.push(`  });`);
    }
  }
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}

function genApiBehaviorTest(check) {
  const examples = Array.isArray(check.examples) && check.examples.length > 0 ? check.examples : [null];
  const executor = resolveBehaviorExecutor(check);
  const needsRawBody = check.then.some(a =>
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
  const needsJson = check.then.some(a =>
    a.json_equals ||
    a.json_matches ||
    a.json_count ||
    a.json_has ||
    a.json_absent ||
    a.json_type ||
    a.json_array_includes ||
    a.json_schema
  );
  const needsSchema = check.then.some(a => a.json_schema);
  const L = [];

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  if (needsJson) {
    pushJsonRuntime(L, needsSchema);
  }
  L.push(`function waitMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }`);
  L.push(``);
  L.push(`async function sendBehaviorApiRequest(client, baseUrl, spec) {`);
  L.push(`  const headers = { ...(spec.headers || {}) };`);
  L.push(`  if (spec.auth) {`);
  L.push(`    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");`);
  L.push(`    if (!authToken) throw new Error("Missing auth token for ShipFlow behavior API step.");`);
  L.push(`    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;`);
  L.push(`  }`);
  L.push(`  const options = {};`);
  L.push(`  if (Object.keys(headers).length > 0) options.headers = headers;`);
  L.push(`  if (spec.body !== undefined) options.data = spec.body;`);
  L.push(`  if (spec.body_json !== undefined) options.data = spec.body_json;`);
  L.push(`  const url = baseUrl + spec.path;`);
  L.push(`  if (Object.keys(options).length > 0) return client[spec.method.toLowerCase()](url, options);`);
  L.push(`  return client[spec.method.toLowerCase()](url);`);
  L.push(`}`);
  L.push(``);
  L.push(`async function executeBehaviorApiSteps(client, baseUrl, steps) {`);
  L.push(`  let lastResponse = null;`);
  L.push(`  for (const step of steps) {`);
  L.push(`    if (step.wait_for) { await waitMs(step.wait_for.ms ?? 250); continue; }`);
  L.push(`    lastResponse = await sendBehaviorApiRequest(client, baseUrl, step.request);`);
  L.push(`  }`);
  L.push(`  return lastResponse;`);
  L.push(`}`);
  L.push(``);
  L.push(`async function readBehaviorApiPayload(res) {`);
  if (needsRawBody) {
    L.push(`  const rawBody = await res.text();`);
  } else {
    L.push(`  const rawBody = "";`);
  }
  if (needsJson) {
    L.push(`  try {`);
    L.push(`    return { rawBody, body: JSON.parse(rawBody), jsonError: null };`);
    L.push(`  } catch (err) {`);
    L.push(`    return { rawBody, body: undefined, jsonError: err.message };`);
    L.push(`  }`);
  } else {
    L.push(`  return { rawBody, body: undefined, jsonError: null };`);
  }
  L.push(`}`);
  L.push(``);
  L.push(`test.describe(${JSON.stringify(check.feature)}, () => {`);
  if (check.tags?.length) {
    L.push(`  // tags: ${check.tags.join(", ")}`);
  }
  L.push(`  // executor: ${executor.kind}/${executor.framework}`);

  for (const [index, example] of examples.entries()) {
    const scenario = buildApiBehaviorScenario(check, example, index);
    L.push(`  test(${JSON.stringify(scenario.title)}, async ({ request }) => {`);
    if (example) L.push(`    // example: ${JSON.stringify(example)}`);
    L.push(`    const givenSteps = ${JSON.stringify(scenario.given)};`);
    L.push(`    const whenSteps = ${JSON.stringify(scenario.when)};`);
    L.push(`    const res = await executeBehaviorApiSteps(request, ${JSON.stringify(scenario.app.base_url)}, [...givenSteps, ...whenSteps]);`);
    L.push(`    if (!res) throw new Error("Behavior API scenario did not send any request.");`);
    if (needsRawBody || needsJson) {
      L.push(`    const payload = await readBehaviorApiPayload(res);`);
      if (needsRawBody) L.push(`    const rawBody = payload.rawBody;`);
      if (needsJson) {
        L.push(`    if (payload.jsonError) throw new Error("Expected JSON response body but parsing failed: " + payload.jsonError + "\\n" + payload.rawBody);`);
        L.push(`    const body = payload.body;`);
      }
    }
    L.push(`    // Then`);
    for (const assertion of scenario.then) {
      L.push(`    ${apiAssertExpr(assertion)}`);
    }
    L.push(`  });`);

    if (scenario.mutation_guard.enabled) {
      L.push(`  test(${JSON.stringify(`${scenario.title} [mutation guard]`)}, async ({ request }) => {`);
      if (example) L.push(`    // example: ${JSON.stringify(example)}`);
      L.push(`    const mutatedVariants = ${JSON.stringify(scenario.mutation_guard.variants)};`);
      L.push(`    let mutationGuardKilled = 0;`);
      L.push(`    const survivors = [];`);
      L.push(`    for (const variant of mutatedVariants) {`);
      L.push(`      const res = await executeBehaviorApiSteps(request, ${JSON.stringify(scenario.app.base_url)}, variant.steps);`);
      L.push(`      if (!res) throw new Error("Behavior API mutation guard did not send any request.");`);
      if (needsRawBody || needsJson) {
        L.push(`      const payload = await readBehaviorApiPayload(res);`);
        if (needsRawBody) L.push(`      const rawBody = payload.rawBody;`);
        if (needsJson) L.push(`      const body = payload.jsonError ? undefined : payload.body;`);
      }
      L.push(`      const mutationGuardPasses = ${needsJson ? "(payload.jsonError ? false : " : ""}[`);
      for (const assertion of scenario.then) {
        L.push(`        ${apiAssertConditionExpr(assertion)},`);
      }
      L.push(`      ].every(Boolean)${needsJson ? ")" : ""};`);
      L.push(`      if (mutationGuardPasses) survivors.push(variant.strategy); else mutationGuardKilled += 1;`);
      L.push(`    }`);
      L.push(`    expect(mutationGuardKilled, "Expected at least one mutation to invalidate the original API behavior. Survivors: " + survivors.join(", ")).toBeGreaterThan(0);`);
      L.push(`  });`);
    }
  }

  L.push(`});`);
  L.push(``);
  return L.join("\n");
}

function genTuiBehaviorTest(check) {
  const examples = Array.isArray(check.examples) && check.examples.length > 0 ? check.examples : [null];
  const executor = resolveBehaviorExecutor(check);
  const L = [];

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(`import { spawn } from "node:child_process";`);
  L.push(`import path from "node:path";`);
  L.push(``);
  pushTuiRuntime(L);
  L.push(`test.describe(${JSON.stringify(check.feature)}, () => {`);
  if (check.tags?.length) {
    L.push(`  // tags: ${check.tags.join(", ")}`);
  }
  L.push(`  // executor: ${executor.kind}/${executor.framework}`);

  for (const [index, example] of examples.entries()) {
    const scenario = buildTuiBehaviorScenario(check, example, index);
    L.push(`  test(${JSON.stringify(scenario.title)}, async () => {`);
    if (example) L.push(`    // example: ${JSON.stringify(example)}`);
    L.push(`    const app = ${JSON.stringify(scenario.app)};`);
    L.push(`    const steps = ${JSON.stringify([...scenario.given, ...scenario.when])};`);
    L.push(`    const session = await startShipFlowTui(app);`);
    L.push(`    try {`);
    L.push(`      for (const step of steps) {`);
    L.push(`        await runShipFlowTuiStep(session, step);`);
    L.push(`      }`);
    L.push(`      const exitCode = await resolveShipFlowExitCode(session, ${scenario.then.some(assertion => assertion.exit_code !== undefined) ? 1000 : 100});`);
    L.push(`      const stdout = session.stdout;`);
    L.push(`      const stderr = session.stderr;`);
    L.push(`      // Then`);
    for (const assertion of scenario.then) {
      L.push(`      ${tuiAssertExpr(assertion)}`);
    }
    L.push(`    } finally {`);
    L.push(`      await stopShipFlowTui(session);`);
    L.push(`    }`);
    L.push(`  });`);

    if (scenario.mutation_guard.enabled) {
      L.push(`  test(${JSON.stringify(`${scenario.title} [mutation guard]`)}, async () => {`);
      if (example) L.push(`    // example: ${JSON.stringify(example)}`);
      L.push(`    const app = ${JSON.stringify(scenario.app)};`);
      L.push(`    const steps = ${JSON.stringify(scenario.mutation_guard.steps)};`);
      L.push(`    const session = await startShipFlowTui(app);`);
      L.push(`    try {`);
      L.push(`      for (const step of steps) {`);
      L.push(`        await runShipFlowTuiStep(session, step);`);
      L.push(`      }`);
      L.push(`      const exitCode = await resolveShipFlowExitCode(session, 250);`);
      L.push(`      const stdout = session.stdout;`);
      L.push(`      const stderr = session.stderr;`);
      L.push(`      const mutationGuardPasses = [`);
      for (const assertion of scenario.then) {
        L.push(`        ${tuiAssertConditionExpr(assertion)},`);
      }
      L.push(`      ].every(Boolean);`);
      L.push(`      expect(mutationGuardPasses, ${JSON.stringify(`Mutation strategy should invalidate the original TUI behavior: ${scenario.mutation_guard.strategy}`)}).toBe(false);`);
      L.push(`    } finally {`);
      L.push(`      await stopShipFlowTui(session);`);
      L.push(`    }`);
      L.push(`  });`);
    }
  }

  L.push(`});`);
  L.push(``);
  return L.join("\n");
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "behavior";
}

function buildResolvedBehaviorScenarios(check, fixturesMap) {
  const examples = Array.isArray(check.examples) && check.examples.length > 0 ? check.examples : [null];
  return examples.map((example, index) => {
    if (check.app.kind === "api") return buildApiBehaviorScenario(check, example, index);
    if (check.app.kind === "tui") return buildTuiBehaviorScenario(check, example, index);
    return buildWebBehaviorScenario(check, fixturesMap, example, index);
  });
}

function buildWebBehaviorScenario(check, fixturesMap, example, index) {
  const title = example ? `${check.id}[${index + 1}]: ${substituteTemplate(check.scenario, example)}` : `${check.id}: ${check.scenario}`;
  const setup = check.setup
    ? (() => {
        const fixture = fixturesMap?.get(check.setup);
        if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
        return fixture.flow.map(step => applyTemplate(step, example));
      })()
    : [];
  const given = check.given.map(step => applyTemplate(step, example));
  const when = check.when.map(step => applyTemplate(step, example));
  const then = check.then.map(assertion => applyTemplate(assertion, example));
  const mutationGuardEnabled = hasInteractiveUiFlow(when)
    && then.some(assertion => assertConditionExpr(assertion));
  return {
    title,
    tags: check.tags || [],
    surface: "web",
    app: applyTemplate(check.app, example),
    setup,
    given,
    when,
    then,
    mutation_guard: {
      enabled: mutationGuardEnabled,
      kind: "web-skip-when",
      strategy: "skip-when",
    },
  };
}

function buildApiBehaviorScenario(check, example, index) {
  const title = example ? `${check.id}[${index + 1}]: ${substituteTemplate(check.scenario, example)}` : `${check.id}: ${check.scenario}`;
  const given = check.given.map(step => applyTemplate(step, example));
  const when = check.when.map(step => applyTemplate(step, example));
  const then = check.then.map(assertion => applyTemplate(assertion, example));
  const { steps, strategy, variants } = buildMutatedApiSequence([...given, ...when]);
  return {
    title,
    tags: check.tags || [],
    surface: "api",
    app: applyTemplate(check.app, example),
    setup: [],
    given,
    when,
    then,
    mutation_guard: {
      enabled: steps.length > 0,
      kind: "api-mutated-sequence",
      strategy,
      steps,
      variants,
    },
  };
}

function buildTuiBehaviorScenario(check, example, index) {
  const title = example ? `${check.id}[${index + 1}]: ${substituteTemplate(check.scenario, example)}` : `${check.id}: ${check.scenario}`;
  const given = check.given.map(step => applyTemplate(step, example));
  const when = check.when.map(step => applyTemplate(step, example));
  const then = check.then.map(assertion => applyTemplate(assertion, example));
  const { steps, strategy } = buildMutatedTuiSequence([...given, ...when]);
  return {
    title,
    tags: check.tags || [],
    surface: "tui",
    app: applyTemplate(check.app, example),
    setup: [],
    given,
    when,
    then,
    mutation_guard: {
      enabled: steps.length > 0,
      kind: "tui-mutated-sequence",
      strategy,
      steps,
    },
  };
}

function buildMutatedApiSequence(steps) {
  const targetIndex = findLastIndex(steps, step => step.request);
  if (targetIndex === -1) return { steps: [], strategy: null, variants: [] };
  const variants = buildMutantApiRequests(steps[targetIndex].request).map(({ mutant, strategy }) => ({
    strategy,
    steps: steps.map((step, index) => index === targetIndex ? { request: mutant } : step),
  }));
  return {
    strategy: variants[0]?.strategy ?? null,
    steps: variants[0]?.steps ?? [],
    variants,
  };
}

function buildMutatedTuiSequence(steps) {
  const targetIndex = findLastIndex(steps, step => step.stdin?.text);
  if (targetIndex === -1) return { steps: [], strategy: null };
  return {
    strategy: "mutated-stdin",
    steps: steps.map((step, index) => {
      if (index !== targetIndex) return step;
      return {
        stdin: {
          ...step.stdin,
          text: mutateTuiInput(step.stdin.text),
        },
      };
    }),
  };
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
}

function mutateTuiInput(text) {
  const suffix = "__shipflow_mutant__";
  if (text.endsWith("\n")) {
    return `${text.slice(0, -1)} ${suffix}\n`;
  }
  return `${text} ${suffix}`;
}

function pushJsonRuntime(lines, includeSchema) {
  lines.push(`function jsonPath(root, path) {`);
  lines.push(`  if (path === "$") return { exists: true, value: root };`);
  lines.push(`  const parts = String(path).replace(/^\\$\\.?/, "").match(/[^.[\\]]+|\\[(\\d+)\\]/g) || [];`);
  lines.push(`  let current = root;`);
  lines.push(`  for (const raw of parts) {`);
  lines.push(`    const key = raw.startsWith("[") ? Number(raw.slice(1, -1)) : raw;`);
  lines.push(`    if (current === null || current === undefined || !(key in Object(current))) return { exists: false, value: undefined };`);
  lines.push(`    current = current[key];`);
  lines.push(`  }`);
  lines.push(`  return { exists: true, value: current };`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`function jsonType(value) {`);
  lines.push(`  if (value === null) return "null";`);
  lines.push(`  if (Array.isArray(value)) return "array";`);
  lines.push(`  return typeof value;`);
  lines.push(`}`);
  lines.push(``);
  if (includeSchema) {
    lines.push(`function jsonMatchesSchema(value, schema) {`);
    lines.push(`  if (schema.type && jsonType(value) !== schema.type) return false;`);
    lines.push(`  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;`);
    lines.push(`  if (schema.required) {`);
    lines.push(`    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;`);
    lines.push(`    for (const key of schema.required) {`);
    lines.push(`      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`  if (schema.properties) {`);
    lines.push(`    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;`);
    lines.push(`    for (const [key, child] of Object.entries(schema.properties)) {`);
    lines.push(`      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;`);
    lines.push(`      if (!jsonMatchesSchema(value[key], child)) return false;`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`  if (schema.items) {`);
    lines.push(`    if (!Array.isArray(value)) return false;`);
    lines.push(`    for (const item of value) {`);
    lines.push(`      if (!jsonMatchesSchema(item, schema.items)) return false;`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`  return true;`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`function assertJsonSchema(value, schema, at = "$") {`);
    lines.push(`  expect(jsonMatchesSchema(value, schema)).toBe(true);`);
    lines.push(`}`);
    lines.push(``);
  }
}

function pushTuiRuntime(lines) {
  lines.push(`function waitMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }`);
  lines.push(``);
  lines.push(`async function startShipFlowTui(app) {`);
  lines.push(`  const child = spawn(app.command, app.args || [], {`);
  lines.push(`    cwd: app.cwd ? path.resolve(process.cwd(), app.cwd) : process.cwd(),`);
  lines.push(`    env: { ...process.env, ...(app.env || {}) },`);
  lines.push(`    stdio: ["pipe", "pipe", "pipe"],`);
  lines.push(`  });`);
  lines.push(`  let stdout = "";`);
  lines.push(`  let stderr = "";`);
  lines.push(`  let exitCode = null;`);
  lines.push(`  child.stdout?.on("data", chunk => { stdout += chunk.toString(); });`);
  lines.push(`  child.stderr?.on("data", chunk => { stderr += chunk.toString(); });`);
  lines.push(`  const exit = new Promise(resolve => {`);
  lines.push(`    child.on("close", code => { exitCode = code ?? 0; resolve(exitCode); });`);
  lines.push(`  });`);
  lines.push(`  await waitMs(25);`);
  lines.push(`  return { child, exit, get stdout() { return stdout; }, get stderr() { return stderr; }, get exitCode() { return exitCode; } };`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runShipFlowTuiStep(session, step) {`);
  lines.push(`  if (step.wait_for) { await waitMs(step.wait_for.ms ?? 250); return; }`);
  lines.push(`  if (step.stdin) {`);
  lines.push(`    session.child.stdin.write(step.stdin.text);`);
  lines.push(`    if (step.stdin.delay_ms) await waitMs(step.stdin.delay_ms);`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  if (step.signal) { session.child.kill(step.signal.name || "SIGINT"); return; }`);
  lines.push(`  throw new Error("Unknown ShipFlow TUI step");`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function resolveShipFlowExitCode(session, timeoutMs = 100) {`);
  lines.push(`  const result = await Promise.race([`);
  lines.push(`    session.exit.then(code => ({ done: true, code })),`);
  lines.push(`    waitMs(timeoutMs).then(() => ({ done: false, code: session.exitCode })),`);
  lines.push(`  ]);`);
  lines.push(`  return result.code;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function stopShipFlowTui(session) {`);
  lines.push(`  if (!session) return;`);
  lines.push(`  if (session.exitCode === null && !session.child.killed) session.child.kill("SIGTERM");`);
  lines.push(`  await Promise.race([session.exit.catch(() => null), waitMs(250)]);`);
  lines.push(`  if (session.exitCode === null && !session.child.killed) session.child.kill("SIGKILL");`);
  lines.push(`  await Promise.race([session.exit.catch(() => null), waitMs(250)]);`);
  lines.push(`}`);
  lines.push(``);
}

function tuiAssertExpr(assertion) {
  if (assertion.stdout_contains) {
    return `expect(stdout).toContain(${JSON.stringify(assertion.stdout_contains)});`;
  }
  if (assertion.stdout_not_contains) {
    return `expect(stdout).not.toContain(${JSON.stringify(assertion.stdout_not_contains)});`;
  }
  if (assertion.stderr_contains) {
    return `expect(stderr).toContain(${JSON.stringify(assertion.stderr_contains)});`;
  }
  if (assertion.stderr_not_contains) {
    return `expect(stderr).not.toContain(${JSON.stringify(assertion.stderr_not_contains)});`;
  }
  if (assertion.exit_code !== undefined) {
    return `expect(exitCode).toBe(${assertion.exit_code});`;
  }
  throw new Error("Unknown TUI assert");
}

function tuiAssertConditionExpr(assertion) {
  if (assertion.stdout_contains) {
    return `stdout.includes(${JSON.stringify(assertion.stdout_contains)})`;
  }
  if (assertion.stdout_not_contains) {
    return `!stdout.includes(${JSON.stringify(assertion.stdout_not_contains)})`;
  }
  if (assertion.stderr_contains) {
    return `stderr.includes(${JSON.stringify(assertion.stderr_contains)})`;
  }
  if (assertion.stderr_not_contains) {
    return `!stderr.includes(${JSON.stringify(assertion.stderr_not_contains)})`;
  }
  if (assertion.exit_code !== undefined) {
    return `exitCode === ${assertion.exit_code}`;
  }
  return "false";
}

export function genBehaviorFeature(check, fixturesMap) {
  const scenarios = buildResolvedBehaviorScenarios(check, fixturesMap);
  const lines = [];

  lines.push(`Feature: ${check.feature}`);
  lines.push(`  # ShipFlow generated Gherkin artifact`);
  lines.push("");

  for (const scenario of scenarios) {
    if (scenario.tags.length > 0) {
      lines.push(`  ${scenario.tags.map(tag => `@${tag.replace(/^@/, "")}`).join(" ")}`);
    }
    lines.push(`  Scenario: ${scenario.title}`);

    if (scenario.setup.length === 0 && scenario.given.length === 0 && scenario.when.length === 0 && scenario.then.length === 0) {
      lines.push("    Given ShipFlow noop");
    } else {
      for (const [index] of scenario.setup.entries()) {
        lines.push(`    Given ShipFlow setup step ${index + 1}`);
      }
      for (const [index] of scenario.given.entries()) {
        lines.push(`    Given ShipFlow given step ${index + 1}`);
      }
      for (const [index] of scenario.when.entries()) {
        lines.push(`    When ShipFlow when step ${index + 1}`);
      }
      for (const [index] of scenario.then.entries()) {
        lines.push(`    Then ShipFlow assert ${index + 1}`);
      }
    }
    lines.push("");

    if (scenario.mutation_guard?.enabled) {
      lines.push(`  Scenario: ${scenario.title} [mutation guard]`);
      if (scenario.surface === "web") {
        for (const [index] of scenario.setup.entries()) {
          lines.push(`    Given ShipFlow setup step ${index + 1}`);
        }
        for (const [index] of scenario.given.entries()) {
          lines.push(`    Given ShipFlow given step ${index + 1}`);
        }
      }
      lines.push("    Then ShipFlow mutation guard");
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function genBehaviorSteps(check, fixturesMap) {
  const scenarios = buildResolvedBehaviorScenarios(check, fixturesMap);
  const lines = [];

  lines.push(`import { Before, After, Given, When, Then } from "@cucumber/cucumber";`);
  lines.push(`import { chromium, expect, request as playwrightRequest } from "@playwright/test";`);
  lines.push(`import { spawn } from "node:child_process";`);
  lines.push(`import path from "node:path";`);
  lines.push(``);
  pushJsonRuntime(lines, scenarios.some(scenario => scenario.then.some(assertion => assertion.json_schema)));
  pushTuiRuntime(lines);
  pushBehaviorCucumberRuntime(lines);
  lines.push(`const SCENARIOS = new Map(${JSON.stringify(scenarios, null, 2)}.map(item => [item.title, item]));`);
  lines.push(``);
  lines.push(`function currentScenario(world) {`);
  lines.push(`  const scenario = SCENARIOS.get(world.__shipflowScenarioName);`);
  lines.push(`  if (!scenario) throw new Error("Unknown ShipFlow Cucumber scenario: " + world.__shipflowScenarioName);`);
  lines.push(`  return scenario;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`Before(async function ({ pickle }) {`);
  lines.push(`  this.__shipflowScenarioName = String(pickle.name || "").replace(/ \\[mutation guard\\]$/, "");`);
  lines.push(`  const scenario = currentScenario(this);`);
  lines.push(`  this.__shipflowApiResponse = null;`);
  lines.push(`  this.__shipflowApiPayload = null;`);
  lines.push(`  if (scenario.surface === "web") {`);
  lines.push(`    this.__shipflowBrowser = await chromium.launch();`);
  lines.push(`    this.__shipflowContext = await this.__shipflowBrowser.newContext();`);
  lines.push(`    this.page = await this.__shipflowContext.newPage();`);
  lines.push(`  } else if (scenario.surface === "api") {`);
  lines.push(`    this.__shipflowRequest = await playwrightRequest.newContext();`);
  lines.push(`  } else if (scenario.surface === "tui") {`);
  lines.push(`    this.__shipflowTui = await startShipFlowTui(scenario.app);`);
  lines.push(`  }`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`After(async function () {`);
  lines.push(`  await this.__shipflowRequest?.dispose?.();`);
  lines.push(`  await stopShipFlowTui(this.__shipflowTui);`);
  lines.push(`  await this.__shipflowContext?.close?.();`);
  lines.push(`  await this.__shipflowBrowser?.close?.();`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Given("ShipFlow noop", async function () {});`);
  lines.push(``);
  lines.push(`Given(/^ShipFlow setup step (\\d+)$/, async function (index) {`);
  lines.push(`  await runBehaviorIndexedStep(this, "setup", index);`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Given(/^ShipFlow given step (\\d+)$/, async function (index) {`);
  lines.push(`  await runBehaviorIndexedStep(this, "given", index);`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`When(/^ShipFlow when step (\\d+)$/, async function (index) {`);
  lines.push(`  await runBehaviorIndexedStep(this, "when", index);`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Then(/^ShipFlow assert (\\d+)$/, async function (index) {`);
  lines.push(`  await runBehaviorIndexedAssert(this, index);`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Then("ShipFlow mutation guard", async function () {`);
  lines.push(`  await runBehaviorMutationGuard(this);`);
  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}

function pushBehaviorCucumberRuntime(lines) {
  lines.push(`function locator(page, spec) {`);
  lines.push(`  if (spec.testid) return page.getByTestId(spec.testid);`);
  lines.push(`  if (spec.label) return page.getByLabel(spec.label);`);
  lines.push(`  if (spec.name_regex) return page.getByRole(spec.role, { name: new RegExp(spec.name) });`);
  lines.push(`  return page.getByRole(spec.role, { name: spec.name });`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runWebBehaviorStep(page, step, baseUrl) {`);
  lines.push(`  if (step.open) { await page.goto(baseUrl + step.open); return; }`);
  lines.push(`  if (step.click) { await locator(page, step.click).click(); return; }`);
  lines.push(`  if (step.fill) { await locator(page, step.fill).fill(step.fill.value); return; }`);
  lines.push(`  if (step.select) { await locator(page, step.select).selectOption(step.select.value); return; }`);
  lines.push(`  if (step.hover) { await locator(page, step.hover).hover(); return; }`);
  lines.push(`  if (step.wait_for) { await waitMs(step.wait_for.ms ?? 250); return; }`);
  lines.push(`  if (step.route_block) {`);
  lines.push(`    await page.route("**" + step.route_block.path, route => route.fulfill({ status: step.route_block.status ?? 500, body: "" }));`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  throw new Error("Unknown ShipFlow web behavior step");`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runWebBehaviorAssert(page, assertion) {`);
  lines.push(`  if (assertion.text_equals) { await expect(page.getByTestId(assertion.text_equals.testid)).toHaveText(assertion.text_equals.equals); return; }`);
  lines.push(`  if (assertion.text_matches) { await expect(page.getByTestId(assertion.text_matches.testid)).toHaveText(new RegExp(assertion.text_matches.regex)); return; }`);
  lines.push(`  if (assertion.visible) { await expect(page.getByTestId(assertion.visible.testid)).toBeVisible(); return; }`);
  lines.push(`  if (assertion.hidden) { await expect(page.getByTestId(assertion.hidden.testid)).toBeHidden(); return; }`);
  lines.push(`  if (assertion.url_matches) { await expect(page).toHaveURL(new RegExp(assertion.url_matches.regex)); return; }`);
  lines.push(`  if (assertion.count) { await expect(page.getByTestId(assertion.count.testid)).toHaveCount(assertion.count.equals); return; }`);
  lines.push(`  throw new Error("Unknown ShipFlow web behavior assertion");`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function webBehaviorAssertMatches(page, assertion) {`);
  lines.push(`  if (assertion.text_equals) return (((await page.getByTestId(assertion.text_equals.testid).textContent().catch(() => null)) ?? "").trim()) === assertion.text_equals.equals;`);
  lines.push(`  if (assertion.text_matches) return new RegExp(assertion.text_matches.regex).test(((await page.getByTestId(assertion.text_matches.testid).textContent().catch(() => null)) ?? "").trim());`);
  lines.push(`  if (assertion.visible) return await page.getByTestId(assertion.visible.testid).isVisible().catch(() => false);`);
  lines.push(`  if (assertion.hidden) return await page.getByTestId(assertion.hidden.testid).isHidden().catch(() => false);`);
  lines.push(`  if (assertion.url_matches) return new RegExp(assertion.url_matches.regex).test(page.url());`);
  lines.push(`  if (assertion.count) return (await page.getByTestId(assertion.count.testid).count().catch(() => -1)) === assertion.count.equals;`);
  lines.push(`  return false;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function sendShipFlowApiRequest(client, baseUrl, spec) {`);
  lines.push(`  const headers = { ...(spec.headers || {}) };`);
  lines.push(`  if (spec.auth) {`);
  lines.push(`    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");`);
  lines.push(`    if (!authToken) throw new Error("Missing auth token for ShipFlow behavior API step.");`);
  lines.push(`    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;`);
  lines.push(`  }`);
  lines.push(`  const options = {};`);
  lines.push(`  if (Object.keys(headers).length > 0) options.headers = headers;`);
  lines.push(`  if (spec.body !== undefined) options.data = spec.body;`);
  lines.push(`  if (spec.body_json !== undefined) options.data = spec.body_json;`);
  lines.push(`  const url = baseUrl + spec.path;`);
  lines.push(`  if (Object.keys(options).length > 0) return client[spec.method.toLowerCase()](url, options);`);
  lines.push(`  return client[spec.method.toLowerCase()](url);`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function readShipFlowApiPayload(res) {`);
  lines.push(`  const rawBody = await res.text();`);
  lines.push(`  try { return { rawBody, body: JSON.parse(rawBody), jsonError: null }; }`);
  lines.push(`  catch (err) { return { rawBody, body: undefined, jsonError: err.message }; }`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runApiBehaviorStep(world, step, baseUrl, client = world.__shipflowRequest) {`);
  lines.push(`  if (step.wait_for) { await waitMs(step.wait_for.ms ?? 250); return; }`);
  lines.push(`  world.__shipflowApiResponse = await sendShipFlowApiRequest(client, baseUrl, step.request);`);
  lines.push(`  world.__shipflowApiPayload = null;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function currentApiPayload(world) {`);
  lines.push(`  if (!world.__shipflowApiResponse) throw new Error("No ShipFlow API response is available for assertion.");`);
  lines.push(`  if (!world.__shipflowApiPayload) world.__shipflowApiPayload = await readShipFlowApiPayload(world.__shipflowApiResponse);`);
  lines.push(`  return world.__shipflowApiPayload;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runApiBehaviorAssert(world, assertion) {`);
  lines.push(`  const res = world.__shipflowApiResponse;`);
  lines.push(`  if (!res) throw new Error("No ShipFlow API response is available for assertion.");`);
  lines.push(`  const payload = await currentApiPayload(world);`);
  lines.push(`  const rawBody = payload.rawBody;`);
  lines.push(`  const body = payload.body;`);
  lines.push(`  if (assertion.status !== undefined) { expect(res.status()).toBe(assertion.status); return; }`);
  lines.push(`  if (assertion.header_equals) { expect(res.headers()[assertion.header_equals.name.toLowerCase()]).toBe(assertion.header_equals.equals); return; }`);
  lines.push(`  if (assertion.header_matches) { const pattern = assertion.header_matches.matches || assertion.header_matches.regex; expect(String(res.headers()[assertion.header_matches.name.toLowerCase()] ?? "")).toMatch(new RegExp(pattern)); return; }`);
  lines.push(`  if (assertion.header_present) { expect(res.headers()[assertion.header_present.name.toLowerCase()]).toBeDefined(); return; }`);
  lines.push(`  if (assertion.header_absent) { expect(res.headers()[assertion.header_absent.name.toLowerCase()]).toBeUndefined(); return; }`);
  lines.push(`  if (assertion.body_contains) { expect(rawBody).toContain(assertion.body_contains); return; }`);
  lines.push(`  if (assertion.body_not_contains) { expect(rawBody).not.toContain(assertion.body_not_contains); return; }`);
  lines.push(`  if (payload.jsonError) throw new Error("Expected JSON response body but parsing failed: " + payload.jsonError + "\\n" + rawBody);`);
  lines.push(`  if (assertion.json_equals) { expect(jsonPath(body, assertion.json_equals.path).exists).toBe(true); expect(jsonPath(body, assertion.json_equals.path).value).toEqual(assertion.json_equals.equals); return; }`);
  lines.push(`  if (assertion.json_matches) { const pattern = assertion.json_matches.matches || assertion.json_matches.regex; expect(jsonPath(body, assertion.json_matches.path).exists).toBe(true); expect(String(jsonPath(body, assertion.json_matches.path).value)).toMatch(new RegExp(pattern)); return; }`);
  lines.push(`  if (assertion.json_count) { expect(jsonPath(body, assertion.json_count.path).exists).toBe(true); expect(jsonPath(body, assertion.json_count.path).value).toHaveLength(assertion.json_count.count); return; }`);
  lines.push(`  if (assertion.json_has) { expect(jsonPath(body, assertion.json_has.path).exists).toBe(true); return; }`);
  lines.push(`  if (assertion.json_absent) { expect(jsonPath(body, assertion.json_absent.path).exists).toBe(false); return; }`);
  lines.push(`  if (assertion.json_type) { expect(jsonPath(body, assertion.json_type.path).exists).toBe(true); expect(jsonType(jsonPath(body, assertion.json_type.path).value)).toBe(assertion.json_type.type); return; }`);
  lines.push(`  if (assertion.json_array_includes) { expect(jsonPath(body, assertion.json_array_includes.path).exists).toBe(true); expect(jsonPath(body, assertion.json_array_includes.path).value).toContainEqual(assertion.json_array_includes.equals); return; }`);
  lines.push(`  if (assertion.json_schema) { expect(jsonPath(body, assertion.json_schema.path).exists).toBe(true); expect(jsonMatchesSchema(jsonPath(body, assertion.json_schema.path).value, assertion.json_schema.schema)).toBe(true); return; }`);
  lines.push(`  throw new Error("Unknown ShipFlow API behavior assertion");`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function apiBehaviorAssertMatches(world, assertion) {`);
  lines.push(`  const res = world.__shipflowApiResponse;`);
  lines.push(`  if (!res) return false;`);
  lines.push(`  const payload = await currentApiPayload(world);`);
  lines.push(`  const rawBody = payload.rawBody;`);
  lines.push(`  const body = payload.body;`);
  lines.push(`  if (assertion.status !== undefined) return res.status() === assertion.status;`);
  lines.push(`  if (assertion.header_equals) return res.headers()[assertion.header_equals.name.toLowerCase()] === assertion.header_equals.equals;`);
  lines.push(`  if (assertion.header_matches) { const pattern = assertion.header_matches.matches || assertion.header_matches.regex; return new RegExp(pattern).test(String(res.headers()[assertion.header_matches.name.toLowerCase()] ?? "")); }`);
  lines.push(`  if (assertion.header_present) return res.headers()[assertion.header_present.name.toLowerCase()] !== undefined;`);
  lines.push(`  if (assertion.header_absent) return res.headers()[assertion.header_absent.name.toLowerCase()] === undefined;`);
  lines.push(`  if (assertion.body_contains) return rawBody.includes(assertion.body_contains);`);
  lines.push(`  if (assertion.body_not_contains) return !rawBody.includes(assertion.body_not_contains);`);
  lines.push(`  if (payload.jsonError) return false;`);
  lines.push(`  if (assertion.json_equals) return jsonPath(body, assertion.json_equals.path).exists && JSON.stringify(jsonPath(body, assertion.json_equals.path).value) === JSON.stringify(assertion.json_equals.equals);`);
  lines.push(`  if (assertion.json_matches) { const pattern = assertion.json_matches.matches || assertion.json_matches.regex; return jsonPath(body, assertion.json_matches.path).exists && new RegExp(pattern).test(String(jsonPath(body, assertion.json_matches.path).value)); }`);
  lines.push(`  if (assertion.json_count) return jsonPath(body, assertion.json_count.path).exists && Array.isArray(jsonPath(body, assertion.json_count.path).value) && jsonPath(body, assertion.json_count.path).value.length === assertion.json_count.count;`);
  lines.push(`  if (assertion.json_has) return jsonPath(body, assertion.json_has.path).exists;`);
  lines.push(`  if (assertion.json_absent) return !jsonPath(body, assertion.json_absent.path).exists;`);
  lines.push(`  if (assertion.json_type) return jsonPath(body, assertion.json_type.path).exists && jsonType(jsonPath(body, assertion.json_type.path).value) === assertion.json_type.type;`);
  lines.push(`  if (assertion.json_array_includes) return jsonPath(body, assertion.json_array_includes.path).exists && Array.isArray(jsonPath(body, assertion.json_array_includes.path).value) && jsonPath(body, assertion.json_array_includes.path).value.some(item => JSON.stringify(item) === JSON.stringify(assertion.json_array_includes.equals));`);
  lines.push(`  if (assertion.json_schema) return jsonPath(body, assertion.json_schema.path).exists && jsonMatchesSchema(jsonPath(body, assertion.json_schema.path).value, assertion.json_schema.schema);`);
  lines.push(`  return false;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runTuiBehaviorAssert(world, assertion) {`);
  lines.push(`  const session = world.__shipflowTui;`);
  lines.push(`  if (!session) throw new Error("No ShipFlow TUI session is active.");`);
  lines.push(`  const exitCode = await resolveShipFlowExitCode(session, assertion.exit_code !== undefined ? 1000 : 100);`);
  lines.push(`  const stdout = session.stdout;`);
  lines.push(`  const stderr = session.stderr;`);
  lines.push(`  if (assertion.stdout_contains) { expect(stdout).toContain(assertion.stdout_contains); return; }`);
  lines.push(`  if (assertion.stdout_not_contains) { expect(stdout).not.toContain(assertion.stdout_not_contains); return; }`);
  lines.push(`  if (assertion.stderr_contains) { expect(stderr).toContain(assertion.stderr_contains); return; }`);
  lines.push(`  if (assertion.stderr_not_contains) { expect(stderr).not.toContain(assertion.stderr_not_contains); return; }`);
  lines.push(`  if (assertion.exit_code !== undefined) { expect(exitCode).toBe(assertion.exit_code); return; }`);
  lines.push(`  throw new Error("Unknown ShipFlow TUI behavior assertion");`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function tuiBehaviorAssertMatches(world, assertion) {`);
  lines.push(`  const session = world.__shipflowTui;`);
  lines.push(`  if (!session) return false;`);
  lines.push(`  const exitCode = await resolveShipFlowExitCode(session, 100);`);
  lines.push(`  const stdout = session.stdout;`);
  lines.push(`  const stderr = session.stderr;`);
  lines.push(`  if (assertion.stdout_contains) return stdout.includes(assertion.stdout_contains);`);
  lines.push(`  if (assertion.stdout_not_contains) return !stdout.includes(assertion.stdout_not_contains);`);
  lines.push(`  if (assertion.stderr_contains) return stderr.includes(assertion.stderr_contains);`);
  lines.push(`  if (assertion.stderr_not_contains) return !stderr.includes(assertion.stderr_not_contains);`);
  lines.push(`  if (assertion.exit_code !== undefined) return exitCode === assertion.exit_code;`);
  lines.push(`  return false;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runBehaviorIndexedStep(world, kind, index) {`);
  lines.push(`  const scenario = currentScenario(world);`);
  lines.push(`  const item = scenario[kind][Number(index) - 1];`);
  lines.push(`  if (!item) throw new Error("Missing ShipFlow " + kind + " step #" + index);`);
  lines.push(`  if (scenario.surface === "web") return runWebBehaviorStep(world.page, item, scenario.app.base_url);`);
  lines.push(`  if (scenario.surface === "api") return runApiBehaviorStep(world, item, scenario.app.base_url);`);
  lines.push(`  if (scenario.surface === "tui") return runShipFlowTuiStep(world.__shipflowTui, item);`);
  lines.push(`  throw new Error("Unsupported ShipFlow behavior surface: " + scenario.surface);`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runBehaviorIndexedAssert(world, index) {`);
  lines.push(`  const scenario = currentScenario(world);`);
  lines.push(`  const assertion = scenario.then[Number(index) - 1];`);
  lines.push(`  if (!assertion) throw new Error("Missing ShipFlow assert #" + index);`);
  lines.push(`  if (scenario.surface === "web") return runWebBehaviorAssert(world.page, assertion);`);
  lines.push(`  if (scenario.surface === "api") return runApiBehaviorAssert(world, assertion);`);
  lines.push(`  if (scenario.surface === "tui") return runTuiBehaviorAssert(world, assertion);`);
  lines.push(`  throw new Error("Unsupported ShipFlow behavior surface: " + scenario.surface);`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runBehaviorMutationGuard(world) {`);
  lines.push(`  const scenario = currentScenario(world);`);
  lines.push(`  if (!scenario.mutation_guard?.enabled) throw new Error("No ShipFlow mutation guard is defined for this scenario.");`);
  lines.push(`  if (scenario.surface === "web") {`);
  lines.push(`    const results = [];`);
  lines.push(`    for (const assertion of scenario.then) results.push(await webBehaviorAssertMatches(world.page, assertion));`);
  lines.push(`    expect(results.every(Boolean)).toBe(false);`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  if (scenario.surface === "api") {`);
  lines.push(`    const requestClient = await playwrightRequest.newContext();`);
  lines.push(`    try {`);
  lines.push(`      const variants = scenario.mutation_guard.variants || [{ strategy: scenario.mutation_guard.strategy, steps: scenario.mutation_guard.steps }];`);
  lines.push(`      let mutationGuardKilled = 0;`);
  lines.push(`      const survivors = [];`);
  lines.push(`      for (const variant of variants) {`);
  lines.push(`        const tempWorld = { __shipflowRequest: requestClient, __shipflowApiResponse: null, __shipflowApiPayload: null };`);
  lines.push(`        for (const step of variant.steps) {`);
  lines.push(`          await runApiBehaviorStep(tempWorld, step, scenario.app.base_url, requestClient);`);
  lines.push(`        }`);
  lines.push(`        const results = [];`);
  lines.push(`        for (const assertion of scenario.then) results.push(await apiBehaviorAssertMatches(tempWorld, assertion));`);
  lines.push(`        if (results.every(Boolean)) survivors.push(variant.strategy); else mutationGuardKilled += 1;`);
  lines.push(`      }`);
  lines.push(`      expect(mutationGuardKilled, "Expected at least one mutation to invalidate the original API behavior. Survivors: " + survivors.join(", ")).toBeGreaterThan(0);`);
  lines.push(`    } finally {`);
  lines.push(`      await requestClient.dispose();`);
  lines.push(`    }`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  if (scenario.surface === "tui") {`);
  lines.push(`    const session = await startShipFlowTui(scenario.app);`);
  lines.push(`    try {`);
  lines.push(`      const tempWorld = { __shipflowTui: session };`);
  lines.push(`      for (const step of scenario.mutation_guard.steps) {`);
  lines.push(`        await runShipFlowTuiStep(session, step);`);
  lines.push(`      }`);
  lines.push(`      const results = [];`);
  lines.push(`      for (const assertion of scenario.then) results.push(await tuiBehaviorAssertMatches(tempWorld, assertion));`);
  lines.push(`      expect(results.every(Boolean)).toBe(false);`);
  lines.push(`    } finally {`);
  lines.push(`      await stopShipFlowTui(session);`);
  lines.push(`    }`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  throw new Error("Unsupported ShipFlow behavior surface: " + scenario.surface);`);
  lines.push(`}`);
  lines.push(``);
}

export function genBehaviorCucumberArtifacts(check, fixturesMap) {
  const baseName = check.__file.replace(/^vp\/behavior\//, "").replace(/\.ya?ml$/, "");
  const safeName = slugify(baseName);
  return [
    {
      relative_dir: "features",
      name: `${safeName}.feature`,
      kind: "cucumber-feature",
      primary: true,
      content: genBehaviorFeature(check, fixturesMap),
    },
    {
      relative_dir: "step_definitions",
      name: `${safeName}.steps.mjs`,
      kind: "cucumber-steps",
      primary: false,
      content: genBehaviorSteps(check, fixturesMap),
    },
  ];
}

function substituteTemplate(input, example) {
  if (!example || typeof input !== "string") return input;
  return input
    .replace(/<([a-zA-Z0-9_]+)>/g, (_, key) => String(example[key] ?? `<${key}>`))
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(example[key] ?? `{{${key}}}`));
}

function applyTemplate(value, example) {
  if (!example) return value;
  if (typeof value === "string") return substituteTemplate(value, example);
  if (Array.isArray(value)) return value.map(item => applyTemplate(item, example));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, applyTemplate(inner, example)]));
  }
  return value;
}
