import { test, expect } from "@playwright/test";

test.describe("Security: authz", () => {
  test("security-unauthenticated-admin: Guest access to admin endpoint is rejected", async ({ request }) => {
    const res = await request.get("http://localhost:3000/api/admin");
    expect(res.status()).toBe(401);
    expect(Object.prototype.hasOwnProperty.call(res.headers(), "x-internal-token")).toBe(false);
    expect(await res.text()).not.toContain("stack trace");
  });
});
