/**
 * 設定モーダルの E2E スモーク（デフォルトのPCビューポートで実行）。
 * 開閉（Esc / タイトル行の閉じるボタン）とビュー間ナビゲーション
 * （メニュー → System Info → 戻る）を確認する。
 * モバイルでのハンバーガー開閉は mobile.spec.js が別途カバーする。
 */
import { test, expect, loadToken, login } from "./helpers.js";

test.describe("settings modal", () => {
  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    // 既存セッションの有無に依らず開けるグローバルショートカット（⌘⇧.）で開く
    await page.keyboard.press("Meta+Shift+Period");
    await expect(page.locator(".settings-panel")).toBeVisible({ timeout: 5000 });
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
    // タイトル（戻るボタン）でメニューに戻れる
    await page.locator(".modal-title-wrap").click();
    await expect(page.locator(".modal-title")).toHaveText("Settings");
    await expect(page.locator(".settings-menu-item", { hasText: "Terminal" }).first()).toBeVisible();
  });

  test("Esc キーでモーダルが閉じる", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-panel")).toBeHidden({ timeout: 5000 });
  });

  test("タイトル行の閉じるボタンでモーダルが閉じる", async ({ page }) => {
    // PCはサイドバーが開いている間ハンバーガー自体を隠すため（TabBar.vue）、
    // 閉じる手段はタイトル行右端の専用ボタン（SettingsPanel.vue）になる。
    await expect(page.locator(".tab-menu-btn")).toHaveCount(0);
    await page.locator(".modal-close-btn").click();
    await expect(page.locator(".settings-panel")).toBeHidden({ timeout: 5000 });
  });
});
