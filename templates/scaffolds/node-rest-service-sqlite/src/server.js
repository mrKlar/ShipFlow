import http from "node:http";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "shipflow-rest-service-scaffold" });
  }

  if (url.pathname.startsWith("/api/")) {
    return json(res, 501, {
      ok: false,
      error: "REST service scaffold is installed but the endpoint is not implemented yet.",
      method: req.method,
      path: url.pathname,
    });
  }

  return json(res, 404, {
    ok: false,
    error: "Not found",
    method: req.method,
    path: url.pathname,
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ShipFlow REST service scaffold listening on http://127.0.0.1:${port}`);
});
