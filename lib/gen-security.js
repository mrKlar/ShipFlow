import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { SecurityCheck } from "./schema/security-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

function mutateValue(value) {
  if (typeof value === "string") return `${value}__shipflow_mutant__`;
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (Array.isArray(value)) return value.length > 0 ? [...value, "__shipflow_mutant__"] : ["__shipflow_mutant__"];
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return { mutant: "__shipflow_mutant__" };
    const [firstKey, firstValue] = entries[0];
    return { ...value, [firstKey]: mutateValue(firstValue) };
  }
  return "__shipflow_mutant__";
}

function appendMutationQuery(apiPath) {
  return `${apiPath}${apiPath.includes("?") ? "&" : "?"}__shipflow_mutant__=1`;
}

function appendMutationPathSegment(apiPath) {
  const [pathname, search = ""] = String(apiPath).split("?");
  const basePath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const mutatedPath = `${basePath || ""}/__shipflow_mutant__`.replace(/\/{2,}/g, "/");
  return search ? `${mutatedPath}?${search}` : mutatedPath;
}

function buildMutantSecurityRequest(request) {
  const mutant = JSON.parse(JSON.stringify(request));
  let strategy = "mutated-path-segment";

  if (mutant.auth) {
    mutant.auth = {
      ...mutant.auth,
      env: undefined,
      token: "__shipflow_invalid_token__",
    };
    strategy = "invalid-auth";
  } else if (mutant.body_json !== undefined) {
    mutant.body_json = mutateValue(mutant.body_json);
    strategy = "mutated-body-json";
  } else if (mutant.body !== undefined) {
    mutant.body = mutateValue(mutant.body);
    strategy = "mutated-body";
  } else if (mutant.headers && Object.keys(mutant.headers).length > 0) {
    mutant.headers = { ...mutant.headers, "x-shipflow-mutant": "1" };
    strategy = "mutated-headers";
  } else if (mutant.path) {
    mutant.path = appendMutationPathSegment(mutant.path);
  } else {
    mutant.path = appendMutationQuery(mutant.path);
    strategy = "path-query";
  }

  return { mutant, strategy };
}

export function readSecurityChecks(vpDir) {
  const dir = path.join(vpDir, "security");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = SecurityCheck.parse(raw);
      parsed.__file = `vp/security/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/security/${f}`, err);
      throw err;
    }
  });
}

export function securityAssertExpr(a) {
  if (a.status !== undefined) {
    return `expect(res.status()).toBe(${a.status});`;
  }
  if (a.header_equals) {
    const { name, equals } = a.header_equals;
    return `expect(res.headers()[${JSON.stringify(name.toLowerCase())}]).toBe(${JSON.stringify(equals)});`;
  }
  if (a.header_matches) {
    const { name, matches, regex } = a.header_matches;
    const pattern = matches || regex;
    return `expect(res.headers()[${JSON.stringify(name.toLowerCase())}]).toMatch(new RegExp(${JSON.stringify(pattern)}));`;
  }
  if (a.header_absent) {
    return `expect(Object.prototype.hasOwnProperty.call(res.headers(), ${JSON.stringify(a.header_absent.name.toLowerCase())})).toBe(false);`;
  }
  if (a.body_contains) {
    return `expect(await res.text()).toContain(${JSON.stringify(a.body_contains)});`;
  }
  if (a.body_not_contains) {
    return `expect(await res.text()).not.toContain(${JSON.stringify(a.body_not_contains)});`;
  }
  throw new Error("Unknown security assert");
}

export function securityAssertConditionExpr(a) {
  if (a.status !== undefined) {
    return `res.status() === ${a.status}`;
  }
  if (a.header_equals) {
    const { name, equals } = a.header_equals;
    return `res.headers()[${JSON.stringify(name.toLowerCase())}] === ${JSON.stringify(equals)}`;
  }
  if (a.header_matches) {
    const { name, matches, regex } = a.header_matches;
    const pattern = matches || regex;
    return `new RegExp(${JSON.stringify(pattern)}).test(String(res.headers()[${JSON.stringify(name.toLowerCase())}] ?? ""))`;
  }
  if (a.header_absent) {
    return `!Object.prototype.hasOwnProperty.call(res.headers(), ${JSON.stringify(a.header_absent.name.toLowerCase())})`;
  }
  if (a.body_contains) {
    return `rawBody.includes(${JSON.stringify(a.body_contains)})`;
  }
  if (a.body_not_contains) {
    return `!rawBody.includes(${JSON.stringify(a.body_not_contains)})`;
  }
  throw new Error("Unknown security assert");
}

export function genSecurityTest(check) {
  const requestSpec = check.request;
  const { mutant: mutantRequestSpec, strategy: mutationStrategy } = buildMutantSecurityRequest(check.request);
  const L = [];
  const needsRawBody = check.assert.some(a => a.body_contains || a.body_not_contains);

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`const shipflowBaseUrl = process.env.SHIPFLOW_BASE_URL || ${JSON.stringify(check.app.base_url)};`);
  L.push(`const REQUEST_SPEC = ${JSON.stringify(requestSpec)};`);
  L.push(`const MUTATION_REQUEST_SPEC = ${JSON.stringify(mutantRequestSpec)};`);
  L.push(``);
  L.push(`async function sendShipFlowSecurityRequest(client, spec) {`);
  L.push(`  const headers = { ...(spec.headers || {}) };`);
  L.push(`  if (spec.auth) {`);
  L.push(`    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");`);
  L.push(`    if (!authToken) throw new Error(${JSON.stringify(`Missing auth token for ${check.id}`)});`);
  L.push(`    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;`);
  L.push(`  }`);
  L.push(`  const options = {};`);
  L.push(`  if (Object.keys(headers).length > 0) options.headers = headers;`);
  L.push(`  if (spec.body !== undefined) options.data = spec.body;`);
  L.push(`  if (spec.body_json !== undefined) options.data = spec.body_json;`);
  L.push(`  const url = shipflowBaseUrl + spec.path;`);
  L.push(`  if (Object.keys(options).length > 0) return client[spec.method.toLowerCase()](url, options);`);
  L.push(`  return client[spec.method.toLowerCase()](url);`);
  L.push(`}`);
  L.push(``);
  L.push(`async function readSecurityPayload(res) {`);
  if (needsRawBody) {
    L.push(`  return await res.text();`);
  } else {
    L.push(`  return "";`);
  }
  L.push(`}`);
  L.push(``);
  L.push(`function responseMatchesOriginalSecurityAssertions(res, rawBody) {`);
  L.push(`  return [`);
  for (const a of check.assert) {
    L.push(`    ${securityAssertConditionExpr(a)},`);
  }
  L.push(`  ].every(Boolean);`);
  L.push(`}`);
  L.push(``);
  L.push(`test.describe(${JSON.stringify(`Security: ${check.category}`)}, () => {`);
  L.push(`  test(${JSON.stringify(`${check.id}: ${check.title}`)}, async ({ request }) => {`);
  L.push(`    const res = await sendShipFlowSecurityRequest(request, REQUEST_SPEC);`);
  if (needsRawBody) {
    L.push(`    const rawBody = await res.text();`);
  }

  for (const a of check.assert) {
    L.push(`    ${securityAssertExpr(a)}`);
  }

  L.push(`  });`);
  L.push(`  test(${JSON.stringify(`${check.id}: ${check.title} [mutation guard]`)}, async ({ request }) => {`);
  L.push(`    const res = await sendShipFlowSecurityRequest(request, MUTATION_REQUEST_SPEC);`);
  L.push(`    const rawBody = await readSecurityPayload(res);`);
  L.push(`    const mutationGuardPasses = responseMatchesOriginalSecurityAssertions(res, rawBody);`);
  L.push(`    expect(mutationGuardPasses, ${JSON.stringify(`Mutation strategy should invalidate the original security contract: ${mutationStrategy}`)}).toBe(false);`);
  L.push(`  });`);
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}
