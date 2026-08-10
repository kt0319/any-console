/**
 * Detached sessions（タブを閉じずにDetachしたセッション）の E2E スモーク。
 * タブの閉じるボタン→確認ダイアログのDetach選択でタブバーから消え、
 * Openタブの「Detached Sessions」カテゴリに表示され、行タップで再アタッチ
 * できることを確認する。
 *
 * テストが開いたセッションは afterEach で必ず後始末する（既存セッションには触れない）。
 */
import { test, expect, listSessionIds, openWorkspaces, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

test.describe("detached sessions", () => {
  const session = useLoginWithSessionCleanup(test);

  test("タブをDetachすると Sessions一覧に続けて現れ、再アタッチできる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();
    await openNewTerminal(page);

    const newSessionId = (await listSessionIds(page)).find((id) => !session.idsBefore.includes(id));
    expect(newSessionId).toBeTruthy();

    // 閉じるボタン→確認ダイアログのDetachを選ぶ
    await tabs.last().locator(".tab-close").click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".confirm-btn-extra2").click();
    await expect(tabs).toHaveCount(countBefore, { timeout: 5000 });

    // Openタブの「Detached Sessions」カテゴリに現れる。
    await openWorkspaces(page);
    const detachedRow = page.locator(`.detached-sessions-li[data-session-id="${newSessionId}"]`);
    await expect(detachedRow).toBeVisible({ timeout: 10_000 });

    // 再アタッチ: 行タップでOpen as tab。タブ行に戻り、Detachedカテゴリから消える
    await detachedRow.click();
    await expect(page.locator(".tab-btn")).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(detachedRow).toHaveCount(0, { timeout: 10_000 });
  });
});
