/** 設定モーダルの E2E スモーク（PCビューポート）。開閉とビュー間ナビゲーションを確認する。モバイルは mobile.spec.js。 */
import { test, expect, loadToken, login, openSettingsModal, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.describe("settings modal", () => {
  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);
    await openSettingsModal(page);
  });

  test("設定メニューが表示される", async ({ page }) => {
    await expect(page.locator(".modal-title")).toHaveText("Settings");
    for (const label of ["Terminal", "Auth", "System Info"]) {
      await expect(page.locator(".settings-menu-item", { hasText: label }).first()).toBeVisible();
    }
  });

  test("System Info に遷移して戻れる", async ({ page }) => {
    await page.locator(".settings-menu-item", { hasText: "System Info" }).click();
    await expect(page.locator(".modal-title")).toContainText("System Info", { timeout: 5000 });
    await page.locator(".modal-title-wrap").click();
    await expect(page.locator(".modal-title")).toHaveText("Settings");
    await expect(page.locator(".settings-menu-item", { hasText: "Terminal" }).first()).toBeVisible();
  });

  test("Esc キーでモーダルが閉じる", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(page.locator(".terminal-settings-modal")).toBeHidden({ timeout: 5000 });
  });

  test("タイトル行の閉じるボタンでモーダルが閉じる", async ({ page }) => {
    // Settings はサイドバーとは独立した全面オーバーレイのため、閉じる手段はタイトル行右端のボタン
    await page.locator(".modal-close-btn").click();
    await expect(page.locator(".terminal-settings-modal")).toBeHidden({ timeout: 5000 });
  });
});
