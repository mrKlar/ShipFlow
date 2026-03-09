import { defineConfig } from "@playwright/test";

const baseURL = process.env.SHIPFLOW_BASE_URL || "http://localhost:3000";
const webServerCommand = process.env.SHIPFLOW_WEB_SERVER_COMMAND || "npm run dev";
const shouldStartWebServer = true || Boolean(process.env.SHIPFLOW_WEB_SERVER_COMMAND);

export default defineConfig({
  testDir: "./playwright",
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
