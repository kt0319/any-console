/**
 * 設定モーダルの E2E スモーク。
 * 開閉（Esc / Close ボタン）とビュー間ナビゲーション（メニュー → System Info → 戻る）を確認する。
 */
import { test, expect, loadToken, login } from "./helpers.js";

test.describe("settings modal", () => {
  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    // 既存セッションの有無に依らず開けるグローバルショートカット（⌘⇧.）で開く
    await page.keyboard.press("Meta+Shift+Period");
    await expect(page.locator(".modal-overlay")).toBeVisible({ timeout: 5000 });
  });

  test("設定メニューが表示される", async ({ page }) => {
    await expect(page.locator(".modal-title")).toHaveText("Settings");
    for (const label of ["Workspaces", "Terminal", "Auth", "System Info"]) {
      await expect(page.locator(".settings-menu-item", { hasText: label }).first()).toBeVisible();
    }
  });

  test("System Info に遷移して戻れる", async ({ page }) => {
    await page.locator(".settings-menu-item", { hasText: "System Info" }).click();
    await expect(page.locator(".modal-title")).toContainText("System Info", { timeout: 5000 });
    // タイトル（戻るボタン）でメニューに戻れる
    await page.locator(".modal-title-wrap").click();
    await expect(page.locator(".modal-title")).toHaveText("Settings");
    await expect(page.locator(".settings-menu-item", { hasText: "Workspaces" }).first()).toBeVisible();
  });

  test("Esc キーでモーダルが閉じる", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal-overlay")).toBeHidden({ timeout: 5000 });
  });

  test("Close ボタンでモーダルが閉じる", async ({ page }) => {
    await page.locator(".modal-close-btn").click();
    await expect(page.locator(".modal-overlay")).toBeHidden({ timeout: 5000 });
  });
});
