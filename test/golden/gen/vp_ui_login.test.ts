import { test, expect } from "@playwright/test";

test("ui-login: User can log in", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/login");
  await page.getByTestId("email-input").fill("user@example.com");
  await page.getByLabel("Password").fill("secret123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard"));
  await expect(page.getByTestId("user-avatar")).toBeVisible();
  await expect(page.getByTestId("welcome-msg")).toHaveText("Welcome back");
});

test("ui-login: User can log in [mutation guard]", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.goto("http://localhost:3000/login");
  const mutationGuardPasses = [
    new RegExp("/dashboard").test(page.url()),
    await page.getByTestId("user-avatar").isVisible().catch(() => false),
    ((await page.getByTestId("welcome-msg").textContent().catch(() => null)) ?? "").trim() === "Welcome back",
  ].every(Boolean);
  expect(mutationGuardPasses).toBe(false);
});
