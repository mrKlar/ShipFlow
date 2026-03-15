import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
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

function mimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function publicFilePath(requestPath) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const target = path.normalize(path.join(publicDir, normalized));
  if (!target.startsWith(publicDir)) return null;
  return target;
}

function servePublic(res, requestPath) {
  const target = publicFilePath(requestPath);
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  res.writeHead(200, { ...SECURITY_HEADERS, "content-type": mimeType(target) });
  res.end(fs.readFileSync(target));
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "shipflow-rest-scaffold" });
  }

  if (url.pathname.startsWith("/api/")) {
    return json(res, 501, {
      ok: false,
      error: "REST API scaffold is installed but the endpoint is not implemented yet.",
      method: req.method,
      path: url.pathname,
    });
  }

  if (req.method === "GET" && servePublic(res, url.pathname)) return;

  res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ShipFlow REST scaffold listening on http://127.0.0.1:${port}`);
});
