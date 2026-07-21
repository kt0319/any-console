/**
 * ターミナルの E2E スモーク。
 * tmux × pty × WebSocket ブリッジの疎通（起動・コマンド実行・出力表示）と、
 * タブクローズ時の確認ダイアログ（Confirm Rules）を確認する。
 *
 * 起動はグローバルショートカット（⌘⇧T）を使い、既存セッションが resume されて
 * タブが開いている状態でも動くようタブ数の増減で検証する。
 * テストが作ったセッションは afterEach で API から削除する（既存セッションには触れない）。
 */
import { test, expect } from "@playwright/test";
import { loadToken, login, listSessionIds, cleanupNewSessions } from "./helpers.js";

test.describe("terminal", () => {
  /** @type {string[]} テスト開始時点のセッション ID（後始末で増分だけ消す） */
  let sessionIdsBefore = [];

  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  // セッションは tmux でサーバ側に残るため、テストが開いたまま終わると
  // 次のテスト・次の実行でも resume され続ける。増えた分をここで必ず消す。
  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  test("New Terminal でタブが開きコマンドを実行できる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();

    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });

    // 新しいタブがアクティブになり、そのターミナルが表示される
    const term = page.locator(".xterm >> visible=true").first();
    await expect(term).toBeVisible({ timeout: 10_000 });

    // シェルのプロンプトが出るまで少し待ってからコマンド実行。
    // 出力(e2e-42)が入力文字列($((41+1)))に含まれない形にして「実行された」ことを検証する。
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type("echo e2e-$((41+1))");
    await page.keyboard.press("Enter");
    await expect(term).toContainText("e2e-42", { timeout: 10_000 });
  });

  test("タブを切り替えても各ターミナルの出力が保持される", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();
    const term = page.locator(".xterm >> visible=true").first();

    // 1つ目: e2e-first-11 を出力
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(term).toBeVisible({ timeout: 10_000 });
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type("echo e2e-first-$((10+1))");
    await page.keyboard.press("Enter");
    await expect(term).toContainText("e2e-first-11", { timeout: 10_000 });

    // 2つ目: e2e-second-22 を出力
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 2, { timeout: 10_000 });
    await expect(term).toBeVisible({ timeout: 10_000 });
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type("echo e2e-second-$((20+2))");
    await page.keyboard.press("Enter");
    await expect(term).toContainText("e2e-second-22", { timeout: 10_000 });
    await expect(term).not.toContainText("e2e-first-11");

    // タブを行き来してもそれぞれの出力が残っている
    await tabs.nth(countBefore).click();
    await expect(term).toContainText("e2e-first-11", { timeout: 10_000 });
    await tabs.nth(countBefore + 1).click();
    await expect(term).toContainText("e2e-second-22", { timeout: 10_000 });
  });

  test("タブを閉じると確認ダイアログが出て Close で閉じる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();

    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });

    // Cancel でタブが残る
    const activeTab = page.locator(".tab-btn.active");
    await activeTab.locator(".tab-close").click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText("Close");
    await dialog.locator(".dialog-btn-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(tabs).toHaveCount(countBefore + 1);

    // Close でタブが消える
    await activeTab.locator(".tab-close").click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-danger").click();
    await expect(tabs).toHaveCount(countBefore, { timeout: 10_000 });
  });
});
