/**
 * モバイルビューポート（375px）でのターミナル体験の E2E スモーク。
 * モバイルではターミナルの下に KeyboardBar（クイックキー / フリック入力バー）が
 * 表示されることを確認する（mobile.spec.js は空画面と設定モーダルのみ対象）。
 *
 * テストが開いたセッションは afterEach で必ず後始末する（既存セッションには触れない）。
 */
import { test, expect, loadToken, login, listSessionIds, cleanupNewSessions } from "./helpers.js";

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.describe("mobile terminal", () => {
  /** @type {string[] | null} テスト開始時点のセッション ID（後始末で増分だけ消す。null = 未取得） */
  let sessionIdsBefore = null;

  test.beforeEach(async ({ page, context }) => {
    sessionIdsBefore = null;
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  test("ターミナルを開くと KeyboardBar が表示される", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();

    // 空画面メニューがあればタップ、なければショートカットで開く
    const menuItem = page.locator(".screen-empty-menu-item", { hasText: "New Terminal" });
    if (await menuItem.count()) {
      await menuItem.tap();
    } else {
      await page.keyboard.press("Meta+Shift+KeyT");
    }
    await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });

    // モバイル（panel-bottom レイアウト）では KeyboardBar が表示される
    const keyboardBar = page.locator(".keyboard-bar");
    await expect(keyboardBar).toBeVisible({ timeout: 10_000 });
    // クイックキー（フリックキー）が最低限並んでいる
    expect(await keyboardBar.locator(".quick-key").count()).toBeGreaterThan(0);
  });
});
