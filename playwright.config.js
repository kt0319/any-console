import { defineConfig } from "@playwright/test";

// any-console の E2E スモーク設定。CI には含めず、ローカルで手動実行する想定。
// 起動済みサーバの URL を ANY_CONSOLE_URL で上書き可能（既定: 開発機の localhost:8888）。
// 認証トークンは ANY_CONSOLE_TOKEN env、もしくは data/auth.json から読む。
export default defineConfig({
  testDir: "./tests/e2e",
  // ヘッドレス、Chromium のみ（個人ツール用途で十分）
  use: {
    baseURL: process.env.ANY_CONSOLE_URL || "http://localhost:8888",
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  // CI 想定なし。並列度は控えめ（tmux セッション共有なので衝突回避）。
  workers: 1,
  retries: 0,
  timeout: 30_000,
});
