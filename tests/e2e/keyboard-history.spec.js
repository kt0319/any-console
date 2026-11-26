/**
 * Send History（モバイル KeyboardBar の History タブ）の E2E スモーク: 送信 → 記録 → 挿入 → 削除。
 * 履歴は localStorage のみのためサーバ側の後始末は不要。
 */
import { test, expect, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.describe("keyboard bar history", () => {
  useLoginWithSessionCleanup(test);

  /**
   * 隅の鍵盤トグルキーで QWERTY パネルを開き、History タブへ切り替える。
   * @param {import("@playwright/test").Page} page
   */
  async function openHistoryPanel(page) {
    await page.locator(".quick-key-toggle").first().tap();
    const historyTab = page.locator('.keyboard-bar-tab[aria-label="History"]');
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.tap();
    await expect(page.locator(".history-list")).toBeVisible({ timeout: 5000 });
  }

  test("入力バーから送信したコマンドが History に載り、挿入・削除できる", async ({ page }) => {
    const term = await openNewTerminal(page, { tap: true });
    await expect(page.locator(".keyboard-bar")).toBeVisible({ timeout: 10_000 });

    // KeyboardInput の Enter はテキストのみ送信し（Enter キーは付けない）、履歴へ追加して入力欄をクリアする。
    const cmd = `echo e2e-hist-${Date.now()}`;
    const input = page.locator(".keyboard-input");
    await input.tap();
    await input.fill(cmd);
    await input.press("Enter");
    await expect(term).toContainText(cmd, { timeout: 10_000 });
    await expect(input).toHaveValue("");

    await openHistoryPanel(page);
    const row = page.locator(".history-row", { hasText: cmd });
    await expect(row).toBeVisible({ timeout: 5000 });

    await row.locator(".history-command").tap();
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(input).toHaveValue(cmd);

    await openHistoryPanel(page);
    await row.locator('.history-delete[aria-label="Delete history entry"]').tap();
    await expect(page.locator(".history-row", { hasText: cmd })).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(".history-empty")).toBeVisible();
  });
});
