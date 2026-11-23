import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Dev-only helper: serves the demo script's owner viewing keys so "Use demo key" works locally.
const demoKeysFile = fileURLToPath(new URL("../../demo/demo-keys.json", import.meta.url));
const demoKeys = () => ({
  name: "demo-keys",
  apply: "serve" as const,
  configureServer(server: any) {
    server.middlewares.use("/__demo-keys", (_req: any, res: any) => {
      res.setHeader("Content-Type", "application/json");
      res.end(existsSync(demoKeysFile) ? readFileSync(demoKeysFile, "utf8") : "[]");
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), demoKeys()],
  server: { port: 3100, strictPort: true },
  // @solana/web3.js references Node globals in the browser.
  define: { global: "globalThis" },
  optimizeDeps: { include: ["buffer"] },
});
