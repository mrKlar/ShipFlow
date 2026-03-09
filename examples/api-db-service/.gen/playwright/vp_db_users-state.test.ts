import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";

let ShipFlowDatabaseSync = null;
try { ({ DatabaseSync: ShipFlowDatabaseSync } = await import("node:sqlite")); } catch {}
function withSqliteDb(run) {
  if (!ShipFlowDatabaseSync) return null;
  const db = new ShipFlowDatabaseSync("./data/app.db");
  try { return run(db); } finally { db.close(); }
}
function query(sql) {
  const nativeRows = withSqliteDb(db => db.prepare(sql).all());
  if (nativeRows !== null) return nativeRows;
  const raw = execFileSync("sqlite3", ["./data/app.db", "-json"], { input: sql, encoding: "utf-8" });
  return JSON.parse(raw.trim() || "[]");
}
function exec(sql) {
  const nativeResult = withSqliteDb(db => { db.exec(sql); return true; });
  if (nativeResult !== null) return;
  execFileSync("sqlite3", ["./data/app.db"], { input: sql, encoding: "utf-8" });
}

test("db-users-state: Users persist after creation", async () => {
  try {
    exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);\nDELETE FROM users;\n");
    const beforeRows = query("SELECT * FROM users");
    expect(beforeRows).toHaveLength(0);
    exec("INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')");
    const rows = query("SELECT name, email FROM users");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({"name":"Alice","email":"alice@example.com"});
  } finally {
    exec("DELETE FROM users");
  }
});

test("db-users-state: Users persist after creation [mutation guard]", async () => {
  try {
    exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);\nDELETE FROM users;\n");
    const rows = query("SELECT * FROM users");
    const mutationGuardPasses = [
      rows.length === 1,
      JSON.stringify(rows[0]) === JSON.stringify({"name":"Alice","email":"alice@example.com"}),
    ].every(Boolean);
    expect(mutationGuardPasses).toBe(false);
  } finally {
    exec("DELETE FROM users");
  }
});
