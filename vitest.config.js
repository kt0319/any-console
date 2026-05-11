import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/ui/test_*.js"],
    coverage: {
      provider: "v8",
      include: [
        "ui/utils/constants.js",
        "ui/utils/display.js",
        "ui/utils/endpoints.js",
        "ui/utils/file-browser.js",
        "ui/utils/git-diff.js",
        "ui/utils/git-graph.js",
        "ui/utils/git.js",
        "ui/utils/page-unload.js",
        "ui/utils/settings-utils.js",
        "ui/utils/storage.js",
        "ui/utils/terminal-settings.js",
        "ui/utils/terminal-ws.js",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
