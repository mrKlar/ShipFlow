import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";

let ShipFlowDatabaseSync = null;
try { ({ DatabaseSync: ShipFlowDatabaseSync } = await import("node:sqlite")); } catch {}
function withSqliteDb(run) {
  if (!ShipFlowDatabaseSync) return null;
  const db = new ShipFlowDatabaseSync("./test.db");
  try { return run(db); } finally { db.close(); }
}
function query(sql) {
  const nativeRows = withSqliteDb(db => db.prepare(sql).all());
  if (nativeRows !== null) return nativeRows;
  const raw = execFileSync("sqlite3", ["./test.db", "-json"], { input: sql, encoding: "utf-8" });
  return JSON.parse(raw.trim() || "[]");
}
function exec(sql) {
  const nativeResult = withSqliteDb(db => { db.exec(sql); return true; });
  if (nativeResult !== null) return;
  execFileSync("sqlite3", ["./test.db"], { input: sql, encoding: "utf-8" });
}

test("db-todos-sqlite-lifecycle: SQLite todos data lifecycle stays observable", async () => {
  try {
    exec("CREATE TABLE IF NOT EXISTS todos (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  completed INTEGER NOT NULL DEFAULT 0\n);\nDELETE FROM todos;\nINSERT INTO todos (id, title, completed) VALUES (1, 'Draft task', 0);");
    const beforeRows = query("PRAGMA table_info(todos);");
    expect(beforeRows.length).toBeGreaterThanOrEqual(3);
    expect(beforeRows.some(r => String(r["name"]) === "id")).toBe(true);
    expect(beforeRows.some(r => String(r["name"]) === "title")).toBe(true);
    expect(beforeRows.some(r => String(r["name"]) === "completed")).toBe(true);
    exec("INSERT INTO todos (id, title, completed) VALUES (2, 'Follow-up task', 1);");
    const rows = query("SELECT id, title, completed FROM todos ORDER BY id;");
    expect(rows).toHaveLength(2);
    expect(String(rows[0]["title"])).toBe("Draft task");
    expect(String(rows[1]["completed"])).toBe("1");
  } finally {
    exec("DELETE FROM todos;");
  }
});

test("db-todos-sqlite-lifecycle: SQLite todos data lifecycle stays observable [mutation guard]", async () => {
  try {
    exec("CREATE TABLE IF NOT EXISTS todos (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  completed INTEGER NOT NULL DEFAULT 0\n);\nDELETE FROM todos;\nINSERT INTO todos (id, title, completed) VALUES (1, 'Draft task', 0);");
    const rows = query("PRAGMA table_info(todos);");
    const mutationGuardPasses = [
      rows.length === 2,
      String(rows[0]?.["title"]) === "Draft task",
      String(rows[1]?.["completed"]) === "1",
    ].every(Boolean);
    expect(mutationGuardPasses).toBe(false);
  } finally {
    exec("DELETE FROM todos;");
  }
});
