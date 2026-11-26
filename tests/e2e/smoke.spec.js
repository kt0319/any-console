// 認証フロー（ログイン画面・不正トークン・メイン画面遷移・認証維持）のスモーク E2E。
import { test, expect, loadToken, login, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.describe("any-console smoke", () => {
  test("ログイン画面が表示される（トークン未認証時）", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
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
    // .tab-menu-btn はハンバーガー/+/歯車で共有のため先頭で代表させる
    await expect(page.locator(".tab-menu-btn").first()).toBeVisible();
  });

  test("認証はリロード後も維持される", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);
    await page.reload();
    await expect(page.locator(".tab-menu-btn").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[placeholder="Token"]')).toBeHidden();
  });
});
