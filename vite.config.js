import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const STATIC_COPY_TARGETS = [
  { src: "ui/sw.js", dest: "dist/sw.js" },
];

// dist/ 配下の静的ファイルを再帰収集し、SW の precache 用パス（'./...'）一覧にする。
// SW 自身（sw.js）は precache 対象から除外する。
function collectPrecacheAssets(root, dir = root) {
  const assets = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      assets.push(...collectPrecacheAssets(root, full));
    } else if (!(dir === root && name === "sw.js")) {
      assets.push("./" + relative(root, full).split(sep).join("/"));
    }
  }
  return assets;
}

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
          // './' は dist に実ファイルが無いが、ナビゲーションのオフライン
          // cold-start 用に precache する（index.html へ解決される）。
          const assets = ["./", ...collectPrecacheAssets("dist")];
          const content = readFileSync(swPath, "utf-8");
          writeFileSync(
            swPath,
            content
              .replace("__BUILD_HASH__", hash)
              .replace("'__PRECACHE_ASSETS__'", JSON.stringify(JSON.stringify(assets))),
          );
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
      "/icons": API_TARGET,
    },
  },
});
