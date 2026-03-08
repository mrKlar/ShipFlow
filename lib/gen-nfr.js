import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { NfrCheck } from "./schema/nfr-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readNfrChecks(vpDir) {
  const dir = path.join(vpDir, "nfr");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = NfrCheck.parse(raw);
      parsed.__file = `vp/nfr/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/nfr/${f}`, err);
      throw err;
    }
  });
}

export function genK6Script(check) {
  const url = check.app.base_url + check.scenario.endpoint;
  const method = check.scenario.method.toLowerCase();
  const {
    thresholds,
    vus,
    duration,
    ramp_up,
    graceful_ramp_down,
    stages,
    expected_status = 200,
  } = check.scenario;
  const L = [];

  L.push(`import http from "k6/http";`);
  L.push(`import { check } from "k6";`);
  L.push(``);
  L.push(`function falsePositiveUrl(target) {`);
  L.push(`  const url = new URL(target);`);
  L.push(`  const suffix = "__shipflow_false_positive__";`);
  L.push(`  url.pathname = url.pathname.endsWith("/") ? url.pathname + suffix : url.pathname + "/" + suffix;`);
  L.push(`  return url.toString();`);
  L.push(`}`);
  L.push(``);

  const thresholdMap = {};
  if (thresholds.http_req_duration_avg !== undefined) {
    thresholdMap.http_req_duration = [...(thresholdMap.http_req_duration || []), `avg<${thresholds.http_req_duration_avg}`];
  }
  if (thresholds.http_req_duration_p90 !== undefined) {
    thresholdMap.http_req_duration = [...(thresholdMap.http_req_duration || []), `p(90)<${thresholds.http_req_duration_p90}`];
  }
  if (thresholds.http_req_duration_p95 !== undefined) {
    thresholdMap.http_req_duration = [...(thresholdMap.http_req_duration || []), `p(95)<${thresholds.http_req_duration_p95}`];
  }
  if (thresholds.http_req_duration_p99 !== undefined) {
    thresholdMap.http_req_duration = [...(thresholdMap.http_req_duration || []), `p(99)<${thresholds.http_req_duration_p99}`];
  }
  if (thresholds.http_req_failed !== undefined) {
    thresholdMap.http_req_failed = [`rate<${thresholds.http_req_failed}`];
  }
  if (thresholds.checks_rate !== undefined) {
    thresholdMap.checks = [`rate>${thresholds.checks_rate}`];
  }

  L.push(`export const options = {`);
  if (Array.isArray(stages) && stages.length > 0) {
    L.push(`  stages: ${JSON.stringify(stages)},`);
  } else if (ramp_up) {
    const derivedStages = [
      { duration: ramp_up, target: vus },
      { duration, target: vus },
      ...(graceful_ramp_down ? [{ duration: graceful_ramp_down, target: 0 }] : []),
    ];
    L.push(`  stages: ${JSON.stringify(derivedStages)},`);
  } else {
    L.push(`  vus: ${vus},`);
    L.push(`  duration: ${JSON.stringify(duration)},`);
  }
  if (graceful_ramp_down && !(Array.isArray(stages) && stages.length > 0)) {
    L.push(`  gracefulRampDown: ${JSON.stringify(graceful_ramp_down)},`);
  }
  const thresholdEntries = Object.entries(thresholdMap);
  if (thresholdEntries.length > 0) {
    L.push(`  thresholds: {`);
    for (const [metric, checks] of thresholdEntries) {
      L.push(`    ${metric}: ${JSON.stringify(checks)},`);
    }
    L.push(`  },`);
  }
  L.push(`};`);
  L.push(``);

  L.push(`export default function () {`);

  const hasHeaders = check.scenario.headers && Object.keys(check.scenario.headers).length > 0;
  const hasBody = check.scenario.body_json !== undefined;
  const params = hasHeaders ? `{ headers: ${JSON.stringify(check.scenario.headers)} }` : null;

  if (method === "get" || method === "delete") {
    if (params) {
      L.push(`  const res = http.${method}(${JSON.stringify(url)}, ${params});`);
      L.push(`  const controlRes = http.${method}(falsePositiveUrl(${JSON.stringify(url)}), ${params});`);
    } else {
      L.push(`  const res = http.${method}(${JSON.stringify(url)});`);
      L.push(`  const controlRes = http.${method}(falsePositiveUrl(${JSON.stringify(url)}));`);
    }
  } else {
    const body = hasBody ? JSON.stringify(JSON.stringify(check.scenario.body_json)) : "null";
    if (params) {
      L.push(`  const res = http.${method}(${JSON.stringify(url)}, ${body}, ${params});`);
      L.push(`  const controlRes = http.${method}(falsePositiveUrl(${JSON.stringify(url)}), ${body}, ${params});`);
    } else {
      L.push(`  const res = http.${method}(${JSON.stringify(url)}, ${body});`);
      L.push(`  const controlRes = http.${method}(falsePositiveUrl(${JSON.stringify(url)}), ${body});`);
    }
  }

  L.push(`  check(res, { "status is ${expected_status}": (r) => r.status === ${expected_status} });`);
  L.push(`  check(controlRes, { "false positive control diverges from expected status": (r) => r.status !== ${expected_status} });`);
  L.push(`}`);
  L.push(``);

  return L.join("\n");
}
