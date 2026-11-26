// モバイルビューポート（375px）での Get Started メニュー → 設定モーダル全画面表示の E2E。
import { test, expect, loadToken, login, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.describe("mobile viewport", () => {
  test("ログイン後に Get Started メニューが表示され設定モーダルが全画面で開く", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);

    // 既存セッションが resume されている場合は空画面が出ないためスキップ（CI では常に空）
    test.skip((await page.locator(".tab-btn").count()) > 0, "既存セッションがあるため空画面テストをスキップ");

    for (const label of ["New Terminal", "Open Session", "Settings"]) {
      await expect(page.locator(".screen-empty-menu-item", { hasText: label })).toBeVisible();
    }

    await page.locator(".screen-empty-menu-item", { hasText: "Settings" }).tap();
    const modal = page.locator(".terminal-settings-modal .modal");
    await expect(modal).toBeVisible({ timeout: 5000 });
    const box = await modal.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(370);

    // ハンバーガーはセッション一覧専用のため、Settings の閉じるには専用ボタンを使う
    await page.locator(".terminal-settings-modal .modal-close-btn").tap();
    await expect(page.locator(".terminal-settings-modal")).toBeHidden({ timeout: 5000 });
  });
});
