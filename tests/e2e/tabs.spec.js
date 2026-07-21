/**
 * タブ管理（Tabs & Sessions）の E2E スモーク。
 * タブ一覧表示・アクティブタブ切替・デタッチ / 再アタッチ・
 * 閉じる時の確認ダイアログ（Confirm Rules）を確認する。
 *
 * テストが開いたセッションは afterEach で必ず後始末する（既存セッションには触れない）。
 */
import { test, expect } from "@playwright/test";
import { loadToken, login, listSessionIds, cleanupNewSessions, openSettingsModal, openSettingsView } from "./helpers.js";

test.describe("tabs & sessions", () => {
  /** @type {string[]} テスト開始時点のセッション ID（後始末で増分だけ消す） */
  let sessionIdsBefore = [];

  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  /** ターミナルを1つ開いて表示を待つ */
  async function openTerminal(page, expectedCount) {
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(page.locator(".tab-btn")).toHaveCount(expectedCount, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });
  }

  test("タブ一覧に開いているタブが並び、ラジオで切り替えられる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();
    await openTerminal(page, countBefore + 1);
    await openTerminal(page, countBefore + 2);

    await openSettingsModal(page);
    await openSettingsView(page, "Tabs & Sessions");
    await expect(page.locator(".modal-title")).toHaveText("Tabs & Sessions");

    const rows = page.locator(".split-tab-row");
    await expect(rows).toHaveCount(countBefore + 2);

    // 最後に開いたタブ（＝最後の行）がアクティブ
    await expect(rows.last()).toHaveClass(/active/);

    // 別の行のラジオをクリックするとアクティブが移る
    const targetRow = rows.nth(countBefore);
    await targetRow.locator(".split-tab-input").click();
    await expect(targetRow).toHaveClass(/active/, { timeout: 5000 });
    await expect(rows.last()).not.toHaveClass(/active/);
  });

  test("タブをデタッチすると Detached に移り、再アタッチできる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();
    await openTerminal(page, countBefore + 1);

    await openSettingsModal(page);
    await openSettingsView(page, "Tabs & Sessions");

    const rows = page.locator(".split-tab-row");
    await expect(rows).toHaveCount(countBefore + 1);
    const detachedBefore = await page.locator(".detached-row").count();

    // デタッチ: タブ行から消え、Detached 一覧に現れる（セッションは残る）
    await rows.last().locator(".split-tab-icon-btn").click();
    await expect(rows).toHaveCount(countBefore, { timeout: 5000 });
    await expect(page.locator(".detached-row")).toHaveCount(detachedBefore + 1, { timeout: 10_000 });

    // 再アタッチ（Open as tab）: タブ行に戻る
    await page.locator('.detached-row .detached-btn[title="Open as tab"]').first().click();
    await expect(page.locator(".tab-btn")).toHaveCount(countBefore + 1, { timeout: 10_000 });
  });

  test("タブ一覧の × は確認ダイアログを経て閉じる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();
    await openTerminal(page, countBefore + 1);

    await openSettingsModal(page);
    await openSettingsView(page, "Tabs & Sessions");

    const rows = page.locator(".split-tab-row");
    await rows.last().locator(".split-tab-close-btn").click();

    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText("Close");

    // Cancel では閉じない
    await dialog.locator(".dialog-btn-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(countBefore + 1);

    // OK で閉じる
    await rows.last().locator(".split-tab-close-btn").click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(rows).toHaveCount(countBefore, { timeout: 10_000 });
    await expect(page.locator(".tab-btn")).toHaveCount(countBefore);
  });
});
