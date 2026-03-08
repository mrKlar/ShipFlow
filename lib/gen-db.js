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

export function dbAssertExpr(a, rowsVar = "rows") {
  if (a.row_count !== undefined) {
    return `expect(${rowsVar}).toHaveLength(${a.row_count});`;
  }
  if (a.row_count_gte !== undefined) {
    return `expect(${rowsVar}.length).toBeGreaterThanOrEqual(${a.row_count_gte});`;
  }
  if (a.row_count_lte !== undefined) {
    return `expect(${rowsVar}.length).toBeLessThanOrEqual(${a.row_count_lte});`;
  }
  if (a.cell_equals) {
    const { row, column, equals } = a.cell_equals;
    return `expect(String(${rowsVar}[${row}][${JSON.stringify(column)}])).toBe(${JSON.stringify(equals)});`;
  }
  if (a.cell_matches) {
    const { row, column, matches } = a.cell_matches;
    return `expect(String(${rowsVar}[${row}][${JSON.stringify(column)}])).toMatch(new RegExp(${JSON.stringify(matches)}));`;
  }
  if (a.column_contains) {
    const { column, value } = a.column_contains;
    return `expect(${rowsVar}.some(r => String(r[${JSON.stringify(column)}]) === ${JSON.stringify(value)})).toBe(true);`;
  }
  if (a.column_not_contains) {
    const { column, value } = a.column_not_contains;
    return `expect(${rowsVar}.some(r => String(r[${JSON.stringify(column)}]) === ${JSON.stringify(value)})).toBe(false);`;
  }
  if (a.row_equals) {
    const { row, equals } = a.row_equals;
    return `expect(${rowsVar}[${row}]).toMatchObject(${JSON.stringify(equals)});`;
  }
  if (a.result_equals) {
    return `expect(${rowsVar}).toEqual(${JSON.stringify(a.result_equals)});`;
  }
  throw new Error("Unknown DB assert");
}

export function dbAssertConditionExpr(a, rowsVar = "rows") {
  if (a.row_count !== undefined) {
    return `${rowsVar}.length === ${a.row_count}`;
  }
  if (a.row_count_gte !== undefined) {
    return `${rowsVar}.length >= ${a.row_count_gte}`;
  }
  if (a.row_count_lte !== undefined) {
    return `${rowsVar}.length <= ${a.row_count_lte}`;
  }
  if (a.cell_equals) {
    const { row, column, equals } = a.cell_equals;
    return `String(${rowsVar}[${row}]?.[${JSON.stringify(column)}]) === ${JSON.stringify(equals)}`;
  }
  if (a.cell_matches) {
    const { row, column, matches } = a.cell_matches;
    return `new RegExp(${JSON.stringify(matches)}).test(String(${rowsVar}[${row}]?.[${JSON.stringify(column)}] ?? ""))`;
  }
  if (a.column_contains) {
    const { column, value } = a.column_contains;
    return `${rowsVar}.some(r => String(r[${JSON.stringify(column)}]) === ${JSON.stringify(value)})`;
  }
  if (a.column_not_contains) {
    const { column, value } = a.column_not_contains;
    return `!${rowsVar}.some(r => String(r[${JSON.stringify(column)}]) === ${JSON.stringify(value)})`;
  }
  if (a.row_equals) {
    const { row, equals } = a.row_equals;
    return `JSON.stringify(${rowsVar}[${row}]) === JSON.stringify(${JSON.stringify(equals)})`;
  }
  if (a.result_equals) {
    return `JSON.stringify(${rowsVar}) === JSON.stringify(${JSON.stringify(a.result_equals)})`;
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
  const seedSql = check.seed_sql || check.setup_sql;
  const mutationGuardSourceQuery = check.before_query || check.query;
  const L = [];

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(`import { execFileSync } from "child_process";`);
  L.push(``);
  L.push(...dbHelpers(engine, connection));
  L.push(``);
  L.push(`test(${JSON.stringify(`${check.id}: ${check.title}`)}, async () => {`);
  L.push(`  try {`);
  if (seedSql) {
    L.push(`    exec(${JSON.stringify(seedSql)});`);
  }
  if (check.before_query) {
    L.push(`    const beforeRows = query(${JSON.stringify(check.before_query)});`);
    for (const a of check.before_assert || []) {
      L.push(`    ${dbAssertExpr(a, "beforeRows")}`);
    }
  }
  if (check.action_sql) {
    L.push(`    exec(${JSON.stringify(check.action_sql)});`);
  }
  L.push(`    const rows = query(${JSON.stringify(check.query)});`);
  for (const a of check.assert) {
    L.push(`    ${dbAssertExpr(a, "rows")}`);
  }
  if (check.after_query) {
    L.push(`    const afterRows = query(${JSON.stringify(check.after_query)});`);
    for (const a of check.after_assert || []) {
      L.push(`    ${dbAssertExpr(a, "afterRows")}`);
    }
  }
  L.push(`  } finally {`);
  if (check.cleanup_sql) {
    L.push(`    exec(${JSON.stringify(check.cleanup_sql)});`);
  }
  L.push(`  }`);
  L.push(`});`);
  L.push(``);

  if (check.action_sql) {
    L.push(`test(${JSON.stringify(`${check.id}: ${check.title} [mutation guard]`)}, async () => {`);
    L.push(`  try {`);
    if (seedSql) {
      L.push(`    exec(${JSON.stringify(seedSql)});`);
    }
    L.push(`    const rows = query(${JSON.stringify(mutationGuardSourceQuery)});`);
    L.push(`    const mutationGuardPasses = [`);
    for (const a of check.assert) {
      L.push(`      ${dbAssertConditionExpr(a, "rows")},`);
    }
    L.push(`    ].every(Boolean);`);
    L.push(`    expect(mutationGuardPasses).toBe(false);`);
    L.push(`  } finally {`);
    if (check.cleanup_sql) {
      L.push(`    exec(${JSON.stringify(check.cleanup_sql)});`);
    }
    L.push(`  }`);
    L.push(`});`);
    L.push(``);
  }

  return L.join("\n");
}
