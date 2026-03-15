import http from "node:http";

const port = Number.parseInt(process.env.PORT || "3001", 10);
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", chunk => parts.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf-8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "shipflow-vue-graphql-scaffold" });
  }

  if (url.pathname === "/graphql") {
    const body = req.method === "POST" ? await readBody(req) : "";
    return json(res, 501, {
      data: null,
      errors: [{
        message: "GraphQL scaffold is installed but the schema and resolvers are not implemented yet.",
      }],
      request: {
        method: req.method,
        body,
      },
    });
  }

  return json(res, 404, { ok: false, error: "Not found", path: url.pathname });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ShipFlow Vue GraphQL scaffold backend listening on http://127.0.0.1:${port}`);
});
