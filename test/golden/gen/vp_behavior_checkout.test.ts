import { test, expect } from "@playwright/test";

test.describe("Shopping Cart", () => {
  test("checkout-flow: User adds item and checks out", async ({ page }) => {
    await page.goto("http://localhost:3000");
    // setup: login-fixture
    await page.goto("http://localhost:3000/login");
    await page.getByTestId("email-input").fill("test@example.com");
    await page.getByLabel("Password").fill("testpass");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(300);
    // Given
    await page.goto("http://localhost:3000/products");
    await page.getByTestId("add-to-cart").click();
    // When
    await page.goto("http://localhost:3000/cart");
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.getByLabel("Card Number").fill("4111111111111111");
    await page.getByRole("button", { name: "Pay" }).click();
    // Then
    await expect(page).toHaveURL(new RegExp("/confirmation"));
    await expect(page.getByTestId("success-message")).toBeVisible();
  });
});
