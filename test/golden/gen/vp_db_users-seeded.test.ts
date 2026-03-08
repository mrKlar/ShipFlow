import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";

function query(sql) {
  const raw = execFileSync("sqlite3", ["./test.db", "-json"], { input: sql, encoding: "utf-8" });
  return JSON.parse(raw.trim() || "[]");
}
function exec(sql) {
  execFileSync("sqlite3", ["./test.db"], { input: sql, encoding: "utf-8" });
}

test("users-seeded: Users table has expected seed data", async () => {
  try {
    exec("INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com');\n");
    const rows = query("SELECT name, email FROM users WHERE email = 'alice@test.com'");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]["name"])).toBe("Alice");
  } finally {
  }
});
