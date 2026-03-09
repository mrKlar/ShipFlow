import { test, expect } from "@playwright/test";

test("filter-todos: User can filter todos by status", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  await page.getByTestId("new-todo-input").fill("Task one");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByTestId("new-todo-input").fill("Task two");
  await page.getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(200);
  await page.getByTestId("todo-toggle-0").click();
  await page.waitForTimeout(200);
  await page.getByLabel("Filter").selectOption("active");
  await page.waitForTimeout(200);
  await expect(page.getByTestId("todo-item")).toHaveCount(1);
  await expect(page.getByTestId("todo-item-0")).toHaveText("Task two");
  await expect(page.getByTestId("no-todos-message")).toBeHidden();
  await expect(page).toHaveURL(new RegExp("filter=active"));
});

test("filter-todos: User can filter todos by status [mutation guard]", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  const mutationGuardPasses = [
    (await page.getByTestId("todo-item").count().catch(() => -1)) === 1,
    ((await page.getByTestId("todo-item-0").textContent().catch(() => null)) ?? "").trim() === "Task two",
    await page.getByTestId("no-todos-message").isHidden().catch(() => false),
    new RegExp("filter=active").test(page.url()),
  ].every(Boolean);
  expect(mutationGuardPasses).toBe(false);
});
