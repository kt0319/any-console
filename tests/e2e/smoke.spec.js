/**
 * any-console スモーク E2E（認証フロー）。CI（e2e ジョブ）で毎回実行し、ローカル手動実行も可能。
 *
 * 前提・実行方法は helpers.js / CLAUDE.md 参照:
 *   ANY_CONSOLE_URL=http://localhost:8888 npm run test:e2e
 */
import { test, expect, loadToken, login, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.describe("any-console smoke", () => {
  test("ログイン画面が表示される（トークン未認証時）", async ({ page, context }) => {
    // 認証なしで開く（cookieも空）
    await context.clearCookies();
    await page.goto("/");
    // どこかにログイン画面の Token プレースホルダがあるはず
    const tokenInput = page.locator('input[placeholder="Token"]');
    await expect(tokenInput).toBeVisible({ timeout: 5000 });
  });

  test("不正なトークンはエラーになりログイン画面に留まる", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
    await page.locator('input[placeholder="Token"]').fill("wrong-token-for-e2e");
    await page.locator("button[type=submit]").click();
    await expect(page.locator(".login-error")).toHaveText("Invalid token", { timeout: 5000 });
    await expect(page.locator(".login-screen")).toBeVisible();
  });

  test("トークン認証でメイン画面に遷移できる", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);
    // ログイン後はメイン画面のタブバー（ハンバーガー）が出る
    await expect(page.locator(".tab-menu-btn")).toBeVisible();
  });

  test("認証はリロード後も維持される", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);
    await page.reload();
    // デバイス cookie で再認証されるため、ログイン画面には戻らない
    await expect(page.locator(".tab-menu-btn")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[placeholder="Token"]')).toBeHidden();
  });
});
