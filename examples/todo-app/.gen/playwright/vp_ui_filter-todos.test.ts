import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

function resetShipFlowState(state) {
  if (!state) return;
  if (state.kind === "sqlite") {
    const db = new DatabaseSync(state.connection);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec(state.reset_sql);
    } finally {
      db.close();
    }
    return;
  }
  throw new Error("Unsupported ShipFlow state kind: " + String(state.kind || "unknown"));
}


test("filter-todos: User can filter todos by status", async ({ page }) => {
  resetShipFlowState({"kind":"sqlite","connection":"./test.db","reset_sql":"CREATE TABLE IF NOT EXISTS todos (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  completed INTEGER NOT NULL DEFAULT 0\n);\nDELETE FROM todos;\nINSERT INTO todos (id, title, completed) VALUES (1, 'Task one', 1);\nINSERT INTO todos (id, title, completed) VALUES (2, 'Task two', 0);"});
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  await page.getByLabel("Filter").selectOption("active");
  await expect(page.getByTestId("todo-item")).toHaveCount(1);
  await expect(page.getByTestId("todo-item-0")).toHaveText("Task two");
  await expect(page.getByTestId("no-todos-message")).toBeHidden();
  await expect(page).toHaveURL(new RegExp("filter=active"));
});

test("filter-todos: User can filter todos by status [mutation guard]", async ({ page }) => {
  resetShipFlowState({"kind":"sqlite","connection":"./test.db","reset_sql":"CREATE TABLE IF NOT EXISTS todos (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  completed INTEGER NOT NULL DEFAULT 0\n);\nDELETE FROM todos;\nINSERT INTO todos (id, title, completed) VALUES (1, 'Task one', 1);\nINSERT INTO todos (id, title, completed) VALUES (2, 'Task two', 0);"});
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  const mutationGuardPasses = [
    (await page.getByTestId("todo-item").count().catch(() => -1)) === 1,
    (await page.getByTestId("todo-item-0").evaluateAll(nodes => ((nodes[0]?.textContent ?? "")).trim())) === "Task two",
    await page.getByTestId("no-todos-message").isHidden().catch(() => false),
    new RegExp("filter=active").test(page.url()),
  ].every(Boolean);
  expect(mutationGuardPasses).toBe(false);
});
