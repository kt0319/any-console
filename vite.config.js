import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const STATIC_COPY_TARGETS = [
  { src: "ui/vendor/css", dest: "dist/vendor/css" },
  { src: "ui/vendor/fonts", dest: "dist/vendor/fonts" },
  { src: "ui/sw.js", dest: "dist/sw.js" },
];

export default defineConfig({
  root: "ui",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
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
      "/auth": "http://localhost:8888",
      "/run": "http://localhost:8888",
      "/workspaces": "http://localhost:8888",
      "/github": "http://localhost:8888",
      "/terminal": { target: "http://localhost:8888", ws: true },
      "/upload-image": "http://localhost:8888",
      "/system": "http://localhost:8888",
      "/settings": "http://localhost:8888",
      "/logs": "http://localhost:8888",
      "/op-logs": "http://localhost:8888",
      "/icons": "http://localhost:8888",
    },
  },
});
