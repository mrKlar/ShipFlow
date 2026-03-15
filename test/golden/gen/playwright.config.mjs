import { defineConfig } from "@playwright/test";

const baseURL = process.env.SHIPFLOW_BASE_URL || "http://localhost:3000";
const webServerCommand = process.env.SHIPFLOW_WEB_SERVER_COMMAND || "npm run dev";
const hasExternalWebServer = process.env.SHIPFLOW_EXTERNAL_WEB_SERVER === "1";
const shouldStartWebServer = !hasExternalWebServer && (true || Boolean(process.env.SHIPFLOW_WEB_SERVER_COMMAND));
const workers = Number(process.env.SHIPFLOW_PLAYWRIGHT_WORKERS || "1");

export default defineConfig({
  testDir: "./playwright",
  workers: Number.isFinite(workers) && workers > 0 ? workers : 1,
  use: {
    baseURL,
  },
  ...(shouldStartWebServer ? {
    webServer: {
      command: webServerCommand,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120000,
    },
  } : {}),
});
