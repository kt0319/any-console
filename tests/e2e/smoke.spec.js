/**
 * any-console スモーク E2E。CI には組み込まない。手動 / ローカル実行用。
 *
 * 前提:
 * - any-console が `ANY_CONSOLE_URL`（既定 http://localhost:8888）で起動済み
 * - ANY_CONSOLE_TOKEN env か data/auth.json の token が利用可能
 *
 * 実行:
 *   ANY_CONSOLE_URL=http://localhost:8888 npm run test:e2e
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function loadToken() {
  if (process.env.ANY_CONSOLE_TOKEN) return process.env.ANY_CONSOLE_TOKEN;
  try {
    const raw = fs.readFileSync(path.resolve("data/auth.json"), "utf8");
    return JSON.parse(raw).token || "";
  } catch {
    return "";
  }
}

test.describe("any-console smoke", () => {
  test("ログイン画面が表示される（トークン未認証時）", async ({ page, context }) => {
    // 認証なしで開く（cookieも空）
    await context.clearCookies();
    await page.goto("/");
    // どこかにログイン画面の Token プレースホルダがあるはず
    const tokenInput = page.locator('input[placeholder="Token"]');
    await expect(tokenInput).toBeVisible({ timeout: 5000 });
  });

  test("トークン認証でメイン画面に遷移できる", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await context.clearCookies();
    await page.goto("/");
    await page.locator('input[placeholder="Token"]').fill(token);
    await page.locator("button[type=submit]").click();
    // ログイン後は何かしらのメイン UI（terminal pane 領域や追加ボタン）が出る想定
    await expect(page.locator(".login-screen")).toBeHidden({ timeout: 5000 });
  });
});
