import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { DbCheck } from "./schema/db-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readDbChecks(vpDir) {
  const dir = path.join(vpDir, "db");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = DbCheck.parse(raw);
      parsed.__file = `vp/db/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/db/${f}`, err);
      throw err;
    }
  });
}

export function dbAssertExpr(a) {
  if (a.row_count !== undefined) {
    return `expect(rows).toHaveLength(${a.row_count});`;
  }
  if (a.cell_equals) {
    const { row, column, equals } = a.cell_equals;
    return `expect(String(rows[${row}][${JSON.stringify(column)}])).toBe(${JSON.stringify(equals)});`;
  }
  if (a.cell_matches) {
    const { row, column, matches } = a.cell_matches;
    return `expect(String(rows[${row}][${JSON.stringify(column)}])).toMatch(new RegExp(${JSON.stringify(matches)}));`;
  }
  if (a.column_contains) {
    const { column, value } = a.column_contains;
    return `expect(rows.some(r => String(r[${JSON.stringify(column)}]) === ${JSON.stringify(value)})).toBe(true);`;
  }
  throw new Error("Unknown DB assert");
}

function dbHelpers(engine, connection) {
  if (engine === "sqlite") {
    return [
      `function query(sql) {`,
      `  const raw = execFileSync("sqlite3", [${JSON.stringify(connection)}, "-json"], { input: sql, encoding: "utf-8" });`,
      `  return JSON.parse(raw.trim() || "[]");`,
      `}`,
      `function exec(sql) {`,
      `  execFileSync("sqlite3", [${JSON.stringify(connection)}], { input: sql, encoding: "utf-8" });`,
      `}`,
    ];
  }
  if (engine === "postgresql") {
    return [
      `function query(sql) {`,
      `  const wrapped = "SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (" + sql + ") t";`,
      `  const raw = execFileSync("psql", [${JSON.stringify(connection)}, "-t", "-A"], { input: wrapped, encoding: "utf-8" });`,
      `  return JSON.parse(raw.trim() || "[]");`,
      `}`,
      `function exec(sql) {`,
      `  execFileSync("psql", [${JSON.stringify(connection)}], { input: sql, encoding: "utf-8" });`,
      `}`,
    ];
  }
  throw new Error(`Unsupported DB engine: ${engine}`);
}

export function genDbTest(check) {
  const { engine, connection } = check.app;
  const L = [];

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(`import { execFileSync } from "child_process";`);
  L.push(``);
  L.push(...dbHelpers(engine, connection));
  L.push(``);
  L.push(`test(${JSON.stringify(`${check.id}: ${check.title}`)}, async () => {`);

  if (check.setup_sql) {
    L.push(`  exec(${JSON.stringify(check.setup_sql)});`);
  }

  L.push(`  const rows = query(${JSON.stringify(check.query)});`);

  for (const a of check.assert) {
    L.push(`  ${dbAssertExpr(a)}`);
  }

  L.push(`});`);
  L.push(``);
  return L.join("\n");
}
