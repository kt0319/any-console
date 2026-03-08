import { cpSync, existsSync } from "node:fs";
import { defineConfig } from "vite";

const VENDOR_SCRIPTS = [
  "vendor/js/highlight.min.js",
  "vendor/js/xterm.js",
  "vendor/js/addon-fit.js",
  "vendor/js/addon-web-links.js",
];

const STATIC_COPY_TARGETS = [
  { src: "ui/vendor", dest: "dist/vendor" },
  { src: "ui/sw.js", dest: "dist/sw.js" },
];

export default defineConfig({
  root: "ui",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [
    {
      name: "vendor-scripts",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          if (html.includes("vendor/js/xterm.js")) return html;
          const tags = VENDOR_SCRIPTS
            .map((s) => `  <script src="${s}"></script>`)
            .join("\n");
          return html.replace("</body>", `${tags}\n</body>`);
        },
      },
    },
    {
      name: "copy-static",
      closeBundle() {
        for (const { src, dest } of STATIC_COPY_TARGETS) {
          if (existsSync(src)) {
            cpSync(src, dest, { recursive: true });
          }
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
