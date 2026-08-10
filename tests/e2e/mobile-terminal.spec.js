/**
 * モバイルビューポート（375px）でのターミナル体験の E2E スモーク。
 * モバイルではターミナルの下に KeyboardBar（クイックキー / フリック入力バー）が
 * 表示されることを確認する（mobile.spec.js は空画面と設定モーダルのみ対象）。
 *
 * テストが開いたセッションは afterEach で必ず後始末する（既存セッションには触れない）。
 */
import { test, expect, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.describe("mobile terminal", () => {
  useLoginWithSessionCleanup(test);

  test("ターミナルを開くと KeyboardBar が表示される", async ({ page }) => {
    await openNewTerminal(page, { tap: true });

    // モバイル（panel-bottom レイアウト）では KeyboardBar が表示される
    const keyboardBar = page.locator(".keyboard-bar");
    await expect(keyboardBar).toBeVisible({ timeout: 10_000 });
    // クイックキー（フリックキー）が最低限並んでいる
    expect(await keyboardBar.locator(".quick-key").count()).toBeGreaterThan(0);
  });
});
