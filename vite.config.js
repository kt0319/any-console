import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const STATIC_COPY_TARGETS = [
  { src: "ui/sw.js", dest: "dist/sw.js" },
];

const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:8888";

export default defineConfig({
  root: "ui",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@xterm/")) return "xterm";
        },
      },
    },
  },
  plugins: [
    vue(),
    {
      name: "copy-static",
      closeBundle() {
        for (const { src, dest } of STATIC_COPY_TARGETS) {
          if (existsSync(src)) {
            cpSync(src, dest, { recursive: true });
          }
        }
        const swPath = "dist/sw.js";
        if (existsSync(swPath)) {
          const hash = execSync("git rev-parse --short HEAD").toString().trim();
          const content = readFileSync(swPath, "utf-8");
          writeFileSync(swPath, content.replace("__BUILD_HASH__", hash));
        }
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/auth": API_TARGET,
      "/run": API_TARGET,
      "/workspaces": API_TARGET,
      "/github": API_TARGET,
      "/terminal": { target: API_TARGET, ws: true },
      "/upload-image": API_TARGET,
      "/system": API_TARGET,
      "/settings": API_TARGET,
      "/logs": API_TARGET,
      "/op-logs": API_TARGET,
      "/icons": API_TARGET,
    },
  },
});
