import { test, expect } from "@playwright/test";

test("complete-todo: User can mark a todo as complete", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  await page.getByTestId("new-todo-input").fill("Write tests");
  await page.getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(200);
  await page.getByTestId("todo-toggle-0").click();
  await page.waitForTimeout(200);
  await expect(page.getByTestId("todo-completed-0")).toBeVisible();
  await expect(page.getByTestId("completed-count")).toHaveText(new RegExp("1 completed"));
});

test("complete-todo: User can mark a todo as complete [mutation guard]", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/");
  const mutationGuardPasses = [
    await page.getByTestId("todo-completed-0").isVisible().catch(() => false),
    new RegExp("1 completed").test(((await page.getByTestId("completed-count").textContent().catch(() => null)) ?? "").trim()),
  ].every(Boolean);
  expect(mutationGuardPasses).toBe(false);
});
