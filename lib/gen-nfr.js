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
  const { thresholds, vus, duration } = check.scenario;
  const L = [];

  L.push(`import http from "k6/http";`);
  L.push(`import { check } from "k6";`);
  L.push(``);

  // Options
  const thresholdEntries = [];
  if (thresholds.http_req_duration_p95 !== undefined) {
    thresholdEntries.push(`    http_req_duration: ["p(95)<${thresholds.http_req_duration_p95}"]`);
  }
  if (thresholds.http_req_duration_p99 !== undefined) {
    thresholdEntries.push(`    http_req_duration: ["p(99)<${thresholds.http_req_duration_p99}"]`);
  }
  if (thresholds.http_req_failed !== undefined) {
    thresholdEntries.push(`    http_req_failed: ["rate<${thresholds.http_req_failed}"]`);
  }

  L.push(`export const options = {`);
  L.push(`  vus: ${vus},`);
  L.push(`  duration: ${JSON.stringify(duration)},`);
  if (thresholdEntries.length > 0) {
    L.push(`  thresholds: {`);
    L.push(thresholdEntries.join(",\n"));
    L.push(`  },`);
  }
  L.push(`};`);
  L.push(``);

  // Default function
  L.push(`export default function () {`);

  const hasHeaders = check.scenario.headers && Object.keys(check.scenario.headers).length > 0;
  const hasBody = check.scenario.body_json !== undefined;
  const params = hasHeaders ? `{ headers: ${JSON.stringify(check.scenario.headers)} }` : null;

  if (method === "get" || method === "delete") {
    if (params) {
      L.push(`  const res = http.${method}(${JSON.stringify(url)}, ${params});`);
    } else {
      L.push(`  const res = http.${method}(${JSON.stringify(url)});`);
    }
  } else {
    const body = hasBody ? JSON.stringify(JSON.stringify(check.scenario.body_json)) : "null";
    if (params) {
      L.push(`  const res = http.${method}(${JSON.stringify(url)}, ${body}, ${params});`);
    } else {
      L.push(`  const res = http.${method}(${JSON.stringify(url)}, ${body});`);
    }
  }

  L.push(`  check(res, { "status is 200": (r) => r.status === 200 });`);
  L.push(`}`);
  L.push(``);

  return L.join("\n");
}
