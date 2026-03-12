import { spawn } from "node:child_process";

const backend = spawn(process.execPath, ["src/server.js"], {
  stdio: "inherit",
  env: { ...process.env, PORT: "3001" },
});

const viteBin = process.platform === "win32" ? "npx.cmd" : "npx";
const frontend = spawn(viteBin, ["vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
  stdio: "inherit",
  env: process.env,
});

function shutdown(code = 0) {
  backend.kill("SIGTERM");
  frontend.kill("SIGTERM");
  process.exit(code);
}

backend.on("exit", code => shutdown(code ?? 0));
frontend.on("exit", code => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
