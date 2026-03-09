import { test, expect } from "@playwright/test";

const REQUEST_SPEC = {"method":"GET","path":"/api/admin"};
const MUTATION_REQUEST_SPEC = {"method":"GET","path":"/api/admin?__shipflow_mutant__=1"};

async function sendShipFlowSecurityRequest(client, spec) {
  const headers = { ...(spec.headers || {}) };
  if (spec.auth) {
    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");
    if (!authToken) throw new Error("Missing auth token for security-admin-authz");
    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;
  }
  const options = {};
  if (Object.keys(headers).length > 0) options.headers = headers;
  if (spec.body !== undefined) options.data = spec.body;
  if (spec.body_json !== undefined) options.data = spec.body_json;
  const url = "http://localhost:3000" + spec.path;
  if (Object.keys(options).length > 0) return client[spec.method.toLowerCase()](url, options);
  return client[spec.method.toLowerCase()](url);
}

async function readSecurityPayload(res) {
  return await res.text();
}

function responseMatchesOriginalSecurityAssertions(res, rawBody) {
  return [
    res.status() === 401,
    !rawBody.includes("stack trace"),
  ].every(Boolean);
}

test.describe("Security: other", () => {
  test("security-admin-authz: Admin route rejects unauthenticated users", async ({ request }) => {
    const res = await sendShipFlowSecurityRequest(request, REQUEST_SPEC);
    const rawBody = await res.text();
    expect(res.status()).toBe(401);
    expect(await res.text()).not.toContain("stack trace");
  });
  test("security-admin-authz: Admin route rejects unauthenticated users [mutation guard]", async ({ request }) => {
    const res = await sendShipFlowSecurityRequest(request, MUTATION_REQUEST_SPEC);
    const rawBody = await readSecurityPayload(res);
    const mutationGuardPasses = responseMatchesOriginalSecurityAssertions(res, rawBody);
    expect(mutationGuardPasses, "Mutation strategy should invalidate the original security contract: path-query").toBe(false);
  });
});
