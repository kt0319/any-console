import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["tests/ui/**/test_*.js"],
    coverage: {
      provider: "v8",
      include: ["ui/utils/**/*.js"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
      },
    },
  },
});
