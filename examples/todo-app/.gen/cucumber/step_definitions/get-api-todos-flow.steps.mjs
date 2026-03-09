import { Before, After, Given, When, Then } from "@cucumber/cucumber";
import { chromium, expect, request as playwrightRequest } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";

function jsonPath(root, path) {
  if (path === "$") return { exists: true, value: root };
  const parts = String(path).replace(/^\$\.?/, "").match(/[^.[\]]+|\[(\d+)\]/g) || [];
  let current = root;
  for (const raw of parts) {
    const key = raw.startsWith("[") ? Number(raw.slice(1, -1)) : raw;
    if (current === null || current === undefined || !(key in Object(current))) return { exists: false, value: undefined };
    current = current[key];
  }
  return { exists: true, value: current };
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function jsonMatchesSchema(value, schema) {
  if (schema.type && jsonType(value) !== schema.type) return false;
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.required) {
    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    }
  }
  if (schema.properties) {
    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (!jsonMatchesSchema(value[key], child)) return false;
    }
  }
  if (schema.items) {
    if (!Array.isArray(value)) return false;
    for (const item of value) {
      if (!jsonMatchesSchema(item, schema.items)) return false;
    }
  }
  return true;
}

function assertJsonSchema(value, schema, at = "$") {
  expect(jsonMatchesSchema(value, schema)).toBe(true);
}

function waitMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function startShipFlowTui(app) {
  const child = spawn(app.command, app.args || [], {
    cwd: app.cwd ? path.resolve(process.cwd(), app.cwd) : process.cwd(),
    env: { ...process.env, ...(app.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let exitCode = null;
  child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
  child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  const exit = new Promise(resolve => {
    child.on("close", code => { exitCode = code ?? 0; resolve(exitCode); });
  });
  await waitMs(25);
  return { child, exit, get stdout() { return stdout; }, get stderr() { return stderr; }, get exitCode() { return exitCode; } };
}

async function runShipFlowTuiStep(session, step) {
  if (step.wait_for) { await waitMs(step.wait_for.ms ?? 250); return; }
  if (step.stdin) {
    session.child.stdin.write(step.stdin.text);
    if (step.stdin.delay_ms) await waitMs(step.stdin.delay_ms);
    return;
  }
  if (step.signal) { session.child.kill(step.signal.name || "SIGINT"); return; }
  throw new Error("Unknown ShipFlow TUI step");
}

async function resolveShipFlowExitCode(session, timeoutMs = 100) {
  const result = await Promise.race([
    session.exit.then(code => ({ done: true, code })),
    waitMs(timeoutMs).then(() => ({ done: false, code: session.exitCode })),
  ]);
  return result.code;
}

async function stopShipFlowTui(session) {
  if (!session) return;
  if (session.exitCode === null && !session.child.killed) session.child.kill("SIGTERM");
  await Promise.race([session.exit.catch(() => null), waitMs(250)]);
  if (session.exitCode === null && !session.child.killed) session.child.kill("SIGKILL");
  await Promise.race([session.exit.catch(() => null), waitMs(250)]);
}

function locator(page, spec) {
  if (spec.testid) return page.getByTestId(spec.testid);
  if (spec.label) return page.getByLabel(spec.label);
  if (spec.name_regex) return page.getByRole(spec.role, { name: new RegExp(spec.name) });
  return page.getByRole(spec.role, { name: spec.name });
}

async function runWebBehaviorStep(page, step, baseUrl) {
  if (step.open) { await page.goto(baseUrl + step.open); return; }
  if (step.click) { await locator(page, step.click).click(); return; }
  if (step.fill) { await locator(page, step.fill).fill(step.fill.value); return; }
  if (step.select) { await locator(page, step.select).selectOption(step.select.value); return; }
  if (step.hover) { await locator(page, step.hover).hover(); return; }
  if (step.wait_for) { await waitMs(step.wait_for.ms ?? 250); return; }
  if (step.route_block) {
    await page.route("**" + step.route_block.path, route => route.fulfill({ status: step.route_block.status ?? 500, body: "" }));
    return;
  }
  throw new Error("Unknown ShipFlow web behavior step");
}

async function runWebBehaviorAssert(page, assertion) {
  if (assertion.text_equals) { await expect(page.getByTestId(assertion.text_equals.testid)).toHaveText(assertion.text_equals.equals); return; }
  if (assertion.text_matches) { await expect(page.getByTestId(assertion.text_matches.testid)).toHaveText(new RegExp(assertion.text_matches.regex)); return; }
  if (assertion.visible) { await expect(page.getByTestId(assertion.visible.testid)).toBeVisible(); return; }
  if (assertion.hidden) { await expect(page.getByTestId(assertion.hidden.testid)).toBeHidden(); return; }
  if (assertion.url_matches) { await expect(page).toHaveURL(new RegExp(assertion.url_matches.regex)); return; }
  if (assertion.count) { await expect(page.getByTestId(assertion.count.testid)).toHaveCount(assertion.count.equals); return; }
  throw new Error("Unknown ShipFlow web behavior assertion");
}

async function webBehaviorAssertMatches(page, assertion) {
  if (assertion.text_equals) return (((await page.getByTestId(assertion.text_equals.testid).textContent().catch(() => null)) ?? "").trim()) === assertion.text_equals.equals;
  if (assertion.text_matches) return new RegExp(assertion.text_matches.regex).test(((await page.getByTestId(assertion.text_matches.testid).textContent().catch(() => null)) ?? "").trim());
  if (assertion.visible) return await page.getByTestId(assertion.visible.testid).isVisible().catch(() => false);
  if (assertion.hidden) return await page.getByTestId(assertion.hidden.testid).isHidden().catch(() => false);
  if (assertion.url_matches) return new RegExp(assertion.url_matches.regex).test(page.url());
  if (assertion.count) return (await page.getByTestId(assertion.count.testid).count().catch(() => -1)) === assertion.count.equals;
  return false;
}

async function sendShipFlowApiRequest(client, baseUrl, spec) {
  const headers = { ...(spec.headers || {}) };
  if (spec.auth) {
    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");
    if (!authToken) throw new Error("Missing auth token for ShipFlow behavior API step.");
    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;
  }
  const options = {};
  if (Object.keys(headers).length > 0) options.headers = headers;
  if (spec.body !== undefined) options.data = spec.body;
  if (spec.body_json !== undefined) options.data = spec.body_json;
  const url = baseUrl + spec.path;
  if (Object.keys(options).length > 0) return client[spec.method.toLowerCase()](url, options);
  return client[spec.method.toLowerCase()](url);
}

async function readShipFlowApiPayload(res) {
  const rawBody = await res.text();
  try { return { rawBody, body: JSON.parse(rawBody), jsonError: null }; }
  catch (err) { return { rawBody, body: undefined, jsonError: err.message }; }
}

async function runApiBehaviorStep(world, step, baseUrl, client = world.__shipflowRequest) {
  if (step.wait_for) { await waitMs(step.wait_for.ms ?? 250); return; }
  world.__shipflowApiResponse = await sendShipFlowApiRequest(client, baseUrl, step.request);
  world.__shipflowApiPayload = null;
}

async function currentApiPayload(world) {
  if (!world.__shipflowApiResponse) throw new Error("No ShipFlow API response is available for assertion.");
  if (!world.__shipflowApiPayload) world.__shipflowApiPayload = await readShipFlowApiPayload(world.__shipflowApiResponse);
  return world.__shipflowApiPayload;
}

async function runApiBehaviorAssert(world, assertion) {
  const res = world.__shipflowApiResponse;
  if (!res) throw new Error("No ShipFlow API response is available for assertion.");
  const payload = await currentApiPayload(world);
  const rawBody = payload.rawBody;
  const body = payload.body;
  if (assertion.status !== undefined) { expect(res.status()).toBe(assertion.status); return; }
  if (assertion.header_equals) { expect(res.headers()[assertion.header_equals.name.toLowerCase()]).toBe(assertion.header_equals.equals); return; }
  if (assertion.header_matches) { const pattern = assertion.header_matches.matches || assertion.header_matches.regex; expect(String(res.headers()[assertion.header_matches.name.toLowerCase()] ?? "")).toMatch(new RegExp(pattern)); return; }
  if (assertion.header_present) { expect(res.headers()[assertion.header_present.name.toLowerCase()]).toBeDefined(); return; }
  if (assertion.header_absent) { expect(res.headers()[assertion.header_absent.name.toLowerCase()]).toBeUndefined(); return; }
  if (assertion.body_contains) { expect(rawBody).toContain(assertion.body_contains); return; }
  if (assertion.body_not_contains) { expect(rawBody).not.toContain(assertion.body_not_contains); return; }
  if (payload.jsonError) throw new Error("Expected JSON response body but parsing failed: " + payload.jsonError + "\n" + rawBody);
  if (assertion.json_equals) { expect(jsonPath(body, assertion.json_equals.path).exists).toBe(true); expect(jsonPath(body, assertion.json_equals.path).value).toEqual(assertion.json_equals.equals); return; }
  if (assertion.json_matches) { const pattern = assertion.json_matches.matches || assertion.json_matches.regex; expect(jsonPath(body, assertion.json_matches.path).exists).toBe(true); expect(String(jsonPath(body, assertion.json_matches.path).value)).toMatch(new RegExp(pattern)); return; }
  if (assertion.json_count) { expect(jsonPath(body, assertion.json_count.path).exists).toBe(true); expect(jsonPath(body, assertion.json_count.path).value).toHaveLength(assertion.json_count.count); return; }
  if (assertion.json_has) { expect(jsonPath(body, assertion.json_has.path).exists).toBe(true); return; }
  if (assertion.json_absent) { expect(jsonPath(body, assertion.json_absent.path).exists).toBe(false); return; }
  if (assertion.json_type) { expect(jsonPath(body, assertion.json_type.path).exists).toBe(true); expect(jsonType(jsonPath(body, assertion.json_type.path).value)).toBe(assertion.json_type.type); return; }
  if (assertion.json_array_includes) { expect(jsonPath(body, assertion.json_array_includes.path).exists).toBe(true); expect(jsonPath(body, assertion.json_array_includes.path).value).toContainEqual(assertion.json_array_includes.equals); return; }
  if (assertion.json_schema) { expect(jsonPath(body, assertion.json_schema.path).exists).toBe(true); expect(jsonMatchesSchema(jsonPath(body, assertion.json_schema.path).value, assertion.json_schema.schema)).toBe(true); return; }
  throw new Error("Unknown ShipFlow API behavior assertion");
}

async function apiBehaviorAssertMatches(world, assertion) {
  const res = world.__shipflowApiResponse;
  if (!res) return false;
  const payload = await currentApiPayload(world);
  const rawBody = payload.rawBody;
  const body = payload.body;
  if (assertion.status !== undefined) return res.status() === assertion.status;
  if (assertion.header_equals) return res.headers()[assertion.header_equals.name.toLowerCase()] === assertion.header_equals.equals;
  if (assertion.header_matches) { const pattern = assertion.header_matches.matches || assertion.header_matches.regex; return new RegExp(pattern).test(String(res.headers()[assertion.header_matches.name.toLowerCase()] ?? "")); }
  if (assertion.header_present) return res.headers()[assertion.header_present.name.toLowerCase()] !== undefined;
  if (assertion.header_absent) return res.headers()[assertion.header_absent.name.toLowerCase()] === undefined;
  if (assertion.body_contains) return rawBody.includes(assertion.body_contains);
  if (assertion.body_not_contains) return !rawBody.includes(assertion.body_not_contains);
  if (payload.jsonError) return false;
  if (assertion.json_equals) return jsonPath(body, assertion.json_equals.path).exists && JSON.stringify(jsonPath(body, assertion.json_equals.path).value) === JSON.stringify(assertion.json_equals.equals);
  if (assertion.json_matches) { const pattern = assertion.json_matches.matches || assertion.json_matches.regex; return jsonPath(body, assertion.json_matches.path).exists && new RegExp(pattern).test(String(jsonPath(body, assertion.json_matches.path).value)); }
  if (assertion.json_count) return jsonPath(body, assertion.json_count.path).exists && Array.isArray(jsonPath(body, assertion.json_count.path).value) && jsonPath(body, assertion.json_count.path).value.length === assertion.json_count.count;
  if (assertion.json_has) return jsonPath(body, assertion.json_has.path).exists;
  if (assertion.json_absent) return !jsonPath(body, assertion.json_absent.path).exists;
  if (assertion.json_type) return jsonPath(body, assertion.json_type.path).exists && jsonType(jsonPath(body, assertion.json_type.path).value) === assertion.json_type.type;
  if (assertion.json_array_includes) return jsonPath(body, assertion.json_array_includes.path).exists && Array.isArray(jsonPath(body, assertion.json_array_includes.path).value) && jsonPath(body, assertion.json_array_includes.path).value.some(item => JSON.stringify(item) === JSON.stringify(assertion.json_array_includes.equals));
  if (assertion.json_schema) return jsonPath(body, assertion.json_schema.path).exists && jsonMatchesSchema(jsonPath(body, assertion.json_schema.path).value, assertion.json_schema.schema);
  return false;
}

async function runTuiBehaviorAssert(world, assertion) {
  const session = world.__shipflowTui;
  if (!session) throw new Error("No ShipFlow TUI session is active.");
  const exitCode = await resolveShipFlowExitCode(session, assertion.exit_code !== undefined ? 1000 : 100);
  const stdout = session.stdout;
  const stderr = session.stderr;
  if (assertion.stdout_contains) { expect(stdout).toContain(assertion.stdout_contains); return; }
  if (assertion.stdout_not_contains) { expect(stdout).not.toContain(assertion.stdout_not_contains); return; }
  if (assertion.stderr_contains) { expect(stderr).toContain(assertion.stderr_contains); return; }
  if (assertion.stderr_not_contains) { expect(stderr).not.toContain(assertion.stderr_not_contains); return; }
  if (assertion.exit_code !== undefined) { expect(exitCode).toBe(assertion.exit_code); return; }
  throw new Error("Unknown ShipFlow TUI behavior assertion");
}

async function tuiBehaviorAssertMatches(world, assertion) {
  const session = world.__shipflowTui;
  if (!session) return false;
  const exitCode = await resolveShipFlowExitCode(session, 100);
  const stdout = session.stdout;
  const stderr = session.stderr;
  if (assertion.stdout_contains) return stdout.includes(assertion.stdout_contains);
  if (assertion.stdout_not_contains) return !stdout.includes(assertion.stdout_not_contains);
  if (assertion.stderr_contains) return stderr.includes(assertion.stderr_contains);
  if (assertion.stderr_not_contains) return !stderr.includes(assertion.stderr_not_contains);
  if (assertion.exit_code !== undefined) return exitCode === assertion.exit_code;
  return false;
}

async function runBehaviorIndexedStep(world, kind, index) {
  const scenario = currentScenario(world);
  const item = scenario[kind][Number(index) - 1];
  if (!item) throw new Error("Missing ShipFlow " + kind + " step #" + index);
  if (scenario.surface === "web") return runWebBehaviorStep(world.page, item, scenario.app.base_url);
  if (scenario.surface === "api") return runApiBehaviorStep(world, item, scenario.app.base_url);
  if (scenario.surface === "tui") return runShipFlowTuiStep(world.__shipflowTui, item);
  throw new Error("Unsupported ShipFlow behavior surface: " + scenario.surface);
}

async function runBehaviorIndexedAssert(world, index) {
  const scenario = currentScenario(world);
  const assertion = scenario.then[Number(index) - 1];
  if (!assertion) throw new Error("Missing ShipFlow assert #" + index);
  if (scenario.surface === "web") return runWebBehaviorAssert(world.page, assertion);
  if (scenario.surface === "api") return runApiBehaviorAssert(world, assertion);
  if (scenario.surface === "tui") return runTuiBehaviorAssert(world, assertion);
  throw new Error("Unsupported ShipFlow behavior surface: " + scenario.surface);
}

async function runBehaviorMutationGuard(world) {
  const scenario = currentScenario(world);
  if (!scenario.mutation_guard?.enabled) throw new Error("No ShipFlow mutation guard is defined for this scenario.");
  if (scenario.surface === "web") {
    const results = [];
    for (const assertion of scenario.then) results.push(await webBehaviorAssertMatches(world.page, assertion));
    expect(results.every(Boolean)).toBe(false);
    return;
  }
  if (scenario.surface === "api") {
    const requestClient = await playwrightRequest.newContext();
    try {
      const variants = scenario.mutation_guard.variants || [{ strategy: scenario.mutation_guard.strategy, steps: scenario.mutation_guard.steps }];
      let mutationGuardKilled = 0;
      const survivors = [];
      for (const variant of variants) {
        const tempWorld = { __shipflowRequest: requestClient, __shipflowApiResponse: null, __shipflowApiPayload: null };
        for (const step of variant.steps) {
          await runApiBehaviorStep(tempWorld, step, scenario.app.base_url, requestClient);
        }
        const results = [];
        for (const assertion of scenario.then) results.push(await apiBehaviorAssertMatches(tempWorld, assertion));
        if (results.every(Boolean)) survivors.push(variant.strategy); else mutationGuardKilled += 1;
      }
      expect(mutationGuardKilled, "Expected at least one mutation to invalidate the original API behavior. Survivors: " + survivors.join(", ")).toBeGreaterThan(0);
    } finally {
      await requestClient.dispose();
    }
    return;
  }
  if (scenario.surface === "tui") {
    const session = await startShipFlowTui(scenario.app);
    try {
      const tempWorld = { __shipflowTui: session };
      for (const step of scenario.mutation_guard.steps) {
        await runShipFlowTuiStep(session, step);
      }
      const results = [];
      for (const assertion of scenario.then) results.push(await tuiBehaviorAssertMatches(tempWorld, assertion));
      expect(results.every(Boolean)).toBe(false);
    } finally {
      await stopShipFlowTui(session);
    }
    return;
  }
  throw new Error("Unsupported ShipFlow behavior surface: " + scenario.surface);
}

const SCENARIOS = new Map([
  {
    "title": "behavior-get-api-todos: POST then GET /api/todos exposes the created todo",
    "tags": [],
    "surface": "api",
    "app": {
      "kind": "api",
      "base_url": "http://localhost:3000"
    },
    "setup": [],
    "given": [],
    "when": [
      {
        "request": {
          "method": "POST",
          "path": "/api/todos",
          "body_json": {
            "title": "Persisted behavior todo",
            "completed": false
          }
        }
      },
      {
        "request": {
          "method": "GET",
          "path": "/api/todos"
        }
      }
    ],
    "then": [
      {
        "status": 200
      },
      {
        "header_matches": {
          "name": "content-type",
          "matches": "json"
        }
      },
      {
        "json_type": {
          "path": "$",
          "type": "array"
        }
      },
      {
        "json_array_includes": {
          "path": "$",
          "equals": {
            "title": "Persisted behavior todo",
            "completed": false
          }
        }
      },
      {
        "json_schema": {
          "path": "$",
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "id",
                "title",
                "completed"
              ],
              "properties": {
                "id": {
                  "type": "number"
                },
                "title": {
                  "type": "string"
                },
                "completed": {
                  "type": "boolean"
                }
              }
            }
          }
        }
      }
    ],
    "mutation_guard": {
      "enabled": true,
      "kind": "api-mutated-sequence",
      "strategy": "mutated-path-segment",
      "steps": [
        {
          "request": {
            "method": "POST",
            "path": "/api/todos",
            "body_json": {
              "title": "Persisted behavior todo",
              "completed": false
            }
          }
        },
        {
          "request": {
            "method": "GET",
            "path": "/api/todos/__shipflow_mutant__"
          }
        }
      ],
      "variants": [
        {
          "strategy": "mutated-path-segment",
          "steps": [
            {
              "request": {
                "method": "POST",
                "path": "/api/todos",
                "body_json": {
                  "title": "Persisted behavior todo",
                  "completed": false
                }
              }
            },
            {
              "request": {
                "method": "GET",
                "path": "/api/todos/__shipflow_mutant__"
              }
            }
          ]
        },
        {
          "strategy": "mutated-method",
          "steps": [
            {
              "request": {
                "method": "POST",
                "path": "/api/todos",
                "body_json": {
                  "title": "Persisted behavior todo",
                  "completed": false
                }
              }
            },
            {
              "request": {
                "method": "POST",
                "path": "/api/todos"
              }
            }
          ]
        },
        {
          "strategy": "path-query",
          "steps": [
            {
              "request": {
                "method": "POST",
                "path": "/api/todos",
                "body_json": {
                  "title": "Persisted behavior todo",
                  "completed": false
                }
              }
            },
            {
              "request": {
                "method": "GET",
                "path": "/api/todos?__shipflow_mutant__=1"
              }
            }
          ]
        }
      ]
    }
  }
].map(item => [item.title, item]));

function currentScenario(world) {
  const scenario = SCENARIOS.get(world.__shipflowScenarioName);
  if (!scenario) throw new Error("Unknown ShipFlow Cucumber scenario: " + world.__shipflowScenarioName);
  return scenario;
}

Before(async function ({ pickle }) {
  this.__shipflowScenarioName = String(pickle.name || "").replace(/ \[mutation guard\]$/, "");
  const scenario = currentScenario(this);
  this.__shipflowApiResponse = null;
  this.__shipflowApiPayload = null;
  if (scenario.surface === "web") {
    this.__shipflowBrowser = await chromium.launch();
    this.__shipflowContext = await this.__shipflowBrowser.newContext();
    this.page = await this.__shipflowContext.newPage();
  } else if (scenario.surface === "api") {
    this.__shipflowRequest = await playwrightRequest.newContext();
  } else if (scenario.surface === "tui") {
    this.__shipflowTui = await startShipFlowTui(scenario.app);
  }
});

After(async function () {
  await this.__shipflowRequest?.dispose?.();
  await stopShipFlowTui(this.__shipflowTui);
  await this.__shipflowContext?.close?.();
  await this.__shipflowBrowser?.close?.();
});

Given("ShipFlow noop", async function () {});

Given(/^ShipFlow setup step (\d+)$/, async function (index) {
  await runBehaviorIndexedStep(this, "setup", index);
});

Given(/^ShipFlow given step (\d+)$/, async function (index) {
  await runBehaviorIndexedStep(this, "given", index);
});

When(/^ShipFlow when step (\d+)$/, async function (index) {
  await runBehaviorIndexedStep(this, "when", index);
});

Then(/^ShipFlow assert (\d+)$/, async function (index) {
  await runBehaviorIndexedAssert(this, index);
});

Then("ShipFlow mutation guard", async function () {
  await runBehaviorMutationGuard(this);
});
