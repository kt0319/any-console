/**
 * ターミナルの E2E スモーク。
 * tmux × pty × WebSocket ブリッジの疎通（起動・コマンド実行・出力表示）と、
 * タブクローズ時の確認ダイアログ（Confirm Rules）を確認する。
 *
 * 起動はグローバルショートカット（⌘⇧T）を使い、既存セッションが resume されて
 * タブが開いている状態でも動くようタブ数の増減で検証する。
 * テストが作ったセッションは afterEach で API から削除する（既存セッションには触れない）。
 */
import { test, expect, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

test.describe("terminal", () => {
  useLoginWithSessionCleanup(test);

  test("New Terminal でタブが開きコマンドを実行できる", async ({ page }) => {
    // 新しいタブがアクティブになり、そのターミナルが表示される
    const term = await openNewTerminal(page);

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
    await openNewTerminal(page);
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type("echo e2e-first-$((10+1))");
    await page.keyboard.press("Enter");
    await expect(term).toContainText("e2e-first-11", { timeout: 10_000 });

    // 2つ目: e2e-second-22 を出力
    await openNewTerminal(page);
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

    await openNewTerminal(page);

    // Cancel でタブが残る(tab-closeボタンでクローズ確認)
    const activeTabClose = page.locator(".tab-btn.active .tab-close");
    await activeTabClose.click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText("Close");
    await dialog.locator(".dialog-btn-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(tabs).toHaveCount(countBefore + 1);

    // Esc でもキャンセルできる（モーダルは Esc で閉じられる MUST ルール）
    await activeTabClose.click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(tabs).toHaveCount(countBefore + 1);

    // Close でタブが消える
    await activeTabClose.click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-danger").click();
    await expect(tabs).toHaveCount(countBefore, { timeout: 10_000 });
  });

  test("タブが幅いっぱいでスクロール可能な時だけ端がフェードする", async ({ page }) => {
    // PCレイアウト（ラベル付きタブ）を維持しつつ幅を制限し、タブ追加だけで
    // 容易にoverflowさせる（MOBILE_BREAKPOINT_PXの768pxは超えたまま）。
    await page.setViewportSize({ width: 900, height: 700 });

    async function maskImage() {
      return page.locator(".tab-bar").evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
    }

    // スクロール不要な間はフェード無し(mask-image: none)
    await expect.poll(maskImage).toBe("none");

    // 幅を超えるまでタブを開くとフェードが付く
    for (let i = 0; i < 15; i++) await openNewTerminal(page);
    await expect.poll(maskImage).not.toBe("none");

    // 先頭までスクロールすると右端だけのフェードになる（右端は透明で終わり、
    // 左は"0px"から不透明で始まる = getComputedStyle正規化後の文字列末尾/先頭で判定）。
    await page.locator(".tab-bar").evaluate((el) => {
      el.scrollLeft = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(async () => {
      const m = await maskImage();
      return m.includes("0px,") && m.endsWith("rgba(0, 0, 0, 0))");
    }).toBe(true);
  });
});
