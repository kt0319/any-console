import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["tests/ui/**/test_*.js"],
    coverage: {
      provider: "v8",
      include: ["ui/utils/**/*.js"],
      exclude: ["ui/utils/mdi-icons.js"],
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
