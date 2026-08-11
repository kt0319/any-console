/**
 * Send History（KeyboardBar の History タブ）の E2E スモーク。
 * Send History は設定メニューから削除され、モバイルのソフトキーボード
 * （KeyboardBar）の History タブが唯一の UI 導線になったため、モバイル
 * ビューポートで入力バーからの送信 → History への記録 → 挿入 → 削除を確認する。
 *
 * 履歴は localStorage のみに保存されるため（stores/input.js）、テストごとに
 * 新規ブラウザコンテキストで空の状態から始まり、サーバ側の後始末は不要。
 */
import { test, expect, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.describe("keyboard bar history", () => {
  useLoginWithSessionCleanup(test);

  /**
   * 隅の鍵盤トグルキーで QWERTY パネルを開き、History タブへ切り替える。
   * （開き方は snippets.spec.js の Snippet タブと同じ導線）
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

    // KeyboardInput の Enter はテキストのみを送信し（Enter キーは付けない）、
    // 送信と同時に入力履歴へ追加・入力欄はクリアされる（KeyboardInput.vue submit）。
    const cmd = `echo e2e-hist-${Date.now()}`;
    const input = page.locator(".keyboard-input");
    await input.tap();
    await input.fill(cmd);
    await input.press("Enter");
    // 送信されたテキストはシェルのプロンプト行にエコーされる
    await expect(term).toContainText(cmd, { timeout: 10_000 });
    await expect(input).toHaveValue("");

    // History タブに載る（新規コンテキストのため履歴はこの1件のみ）
    await openHistoryPanel(page);
    const row = page.locator(".history-row", { hasText: cmd });
    await expect(row).toBeVisible({ timeout: 5000 });

    // 行タップでパネルが閉じ、入力バーへ挿入される（再編集して送り直せる）
    await row.locator(".history-command").tap();
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(input).toHaveValue(cmd);

    // 削除で一覧から消え、空表示に戻る
    await openHistoryPanel(page);
    await row.locator('.history-delete[aria-label="Delete history entry"]').tap();
    await expect(page.locator(".history-row", { hasText: cmd })).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(".history-empty")).toBeVisible();
  });
});
