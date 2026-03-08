import { test, expect } from "@playwright/test";

function jsonPath(root, path) {
  if (path === "$") return { exists: true, value: root };
  const parts = String(path).replace(/^\$\.?/, "").match(/[^.[\]]+|\[(\d+)\]/g) || [];
  let current = root;
  for (const raw of parts) {
    const key = raw.startsWith("[") ? Number(raw.slice(1, -1)) : raw;
    if (current === null || current === undefined || !(key in Object(current))) return { exists: false, value: undefined };
    current = current[key];
  }
  return { exists: true, value: current };
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

test("list-users: GET /api/users returns user list", async ({ request }) => {
  const headers = {"Authorization":"Bearer test-token"};
  const res = await request.get("http://localhost:3000/api/users", {
    headers,
  });
  const rawBody = await res.text();
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    throw new Error("Expected JSON response body but parsing failed: " + err.message + "\n" + rawBody);
  }
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(new RegExp("application/json"));
  expect(jsonPath(body, "$").exists).toBe(true); expect(jsonPath(body, "$").value).toHaveLength(3);
  expect(jsonPath(body, "$[0].name").exists).toBe(true); expect(jsonPath(body, "$[0].name").value).toEqual("Alice");
});
