import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const frontendPort = Number.parseInt(process.env.PORT || "3000", 10);

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: Number.isFinite(frontendPort) && frontendPort > 0 ? frontendPort : 3000,
    strictPort: true,
    proxy: {
      "/graphql": "http://127.0.0.1:3001",
      "/health": "http://127.0.0.1:3001",
    },
  },
});
