// Detached sessions: タブを Detach → Sessions 一覧に表示 → 再アタッチ / Close の E2E。
import { test, expect, listSessionIds, openWorkspaces, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

test.describe("detached sessions", () => {
  const session = useLoginWithSessionCleanup(test);

  test("タブをDetachすると Sessions一覧に続けて現れ、再アタッチできる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();
    await openNewTerminal(page);

    const newSessionId = (await listSessionIds(page)).find((id) => !session.idsBefore.includes(id));
    expect(newSessionId).toBeTruthy();

    await tabs.last().locator(".tab-close").click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".confirm-btn-extra").click();
    await expect(tabs).toHaveCount(countBefore, { timeout: 5000 });

    await openWorkspaces(page);
    const detachedRow = page.locator(`.detached-sessions-li[data-session-id="${newSessionId}"]`);
    await expect(detachedRow).toBeVisible({ timeout: 10_000 });

    await detachedRow.click();
    await expect(page.locator(".tab-btn")).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(detachedRow).toHaveCount(0, { timeout: 10_000 });
  });
  test("Detached一覧の×で確認の上セッションを閉じられる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();
    await openNewTerminal(page);

    const newSessionId = (await listSessionIds(page)).find((id) => !session.idsBefore.includes(id));
    expect(newSessionId).toBeTruthy();

    await tabs.last().locator(".tab-close").click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".confirm-btn-extra").click();
    await expect(tabs).toHaveCount(countBefore, { timeout: 5000 });

    await openWorkspaces(page);
    const detachedRow = page.locator(`.detached-sessions-li[data-session-id="${newSessionId}"]`);
    await expect(detachedRow).toBeVisible({ timeout: 10_000 });

    await detachedRow.locator('[aria-label="Close session"]').click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText("Close session");
    await dialog.locator(".dialog-close-btn").click();
    await expect(dialog).toBeHidden();
    await expect(detachedRow).toBeVisible();
    expect(await listSessionIds(page)).toContain(newSessionId);

    await detachedRow.locator('[aria-label="Close session"]').click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".confirm-buttons .dialog-btn").last().click();
    await expect(detachedRow).toHaveCount(0, { timeout: 10_000 });
    expect(await listSessionIds(page)).not.toContain(newSessionId);
    await expect(tabs).toHaveCount(countBefore);
  });
});
