import { test, expect } from "@playwright/test";

test("add-todo: User can add a new todo item", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  await page.getByTestId("new-todo-input").fill("Buy groceries");
  await page.getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("todo-item-last")).toHaveText("Buy groceries");
  await expect(page.getByTestId("todo-item")).toHaveCount(1);
});

test("add-todo: User can add a new todo item [mutation guard]", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  const mutationGuardPasses = [
    ((await page.getByTestId("todo-item-last").textContent().catch(() => null)) ?? "").trim() === "Buy groceries",
    (await page.getByTestId("todo-item").count().catch(() => -1)) === 1,
  ].every(Boolean);
  expect(mutationGuardPasses).toBe(false);
});
