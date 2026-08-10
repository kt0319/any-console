/**
 * モバイルビューポートの E2E スモーク。
 * モバイルファースト UI が小画面でも主要フロー（ログイン → メニュー → 設定モーダル）を提供できることを確認する。
 */
import { test, expect, loadToken, login, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.describe("mobile viewport", () => {
  test("ログイン後に Get Started メニューが表示され設定モーダルが全画面で開く", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);

    // 既存セッションが resume されている場合は空画面が出ないためスキップ（CI では常に空）
    test.skip((await page.locator(".tab-btn").count()) > 0, "既存セッションがあるため空画面テストをスキップ");

    // Get Started メニューが収まって表示される
    for (const label of ["New Terminal", "Open Session", "Settings"]) {
      await expect(page.locator(".screen-empty-menu-item", { hasText: label })).toBeVisible();
    }

    // 設定モーダルはモバイルでは全画面表示
    await page.locator(".screen-empty-menu-item", { hasText: "Settings" }).tap();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible({ timeout: 5000 });
    const box = await modal.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(370);

    // ハンバーガー（開いている間は Close に変わる）で閉じられる
    await page.locator(".tab-menu-btn").tap();
    await expect(page.locator(".modal-overlay")).toBeHidden({ timeout: 5000 });
  });
});
