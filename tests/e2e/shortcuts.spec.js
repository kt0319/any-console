/**
 * グローバルキーボードショートカットの E2E スモーク（useGlobalShortcuts.js）。
 * ⌘⇧T（New Terminal）と ⌘⇧.（Settings）は terminal / settings スペックで
 * 使用済みのため、ここでは ⌘⇧N（Open Workspace）と ⌘⇧W（Close Tab）を確認する。
 */
import { test, expect, loadToken, login, listSessionIds, cleanupNewSessions } from "./helpers.js";

test.describe("global shortcuts", () => {
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

  test("⌘⇧N で Workspaces モーダルが開き、Esc で閉じる", async ({ page }) => {
    await page.keyboard.press("Meta+Shift+KeyN");
    await expect(page.locator(".settings-panel")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".modal-title")).toHaveText("Workspaces");

    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-panel")).toBeHidden({ timeout: 5000 });
  });

  test("⌘⇧W でアクティブタブを確認ダイアログ付きで閉じられる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();

    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });

    // Cancel でタブが残る
    await page.keyboard.press("Meta+Shift+KeyW");
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(tabs).toHaveCount(countBefore + 1);

    // Close で閉じる
    await page.keyboard.press("Meta+Shift+KeyW");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-danger").click();
    await expect(tabs).toHaveCount(countBefore, { timeout: 10_000 });
  });
});
