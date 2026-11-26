/**
 * タブバーの「+」（Open Session）/ 歯車（Settings）ボタンの E2E スモーク。
 */
import { test, expect, openSettingsView, popToNavRoot, useLoginWithSessionCleanup } from "./helpers.js";

test.describe("tab bar: open session / settings buttons", () => {
  useLoginWithSessionCleanup(test);

  test("+ボタンでOpen SessionモーダルがSessionOpenHomeルートで開く", async ({ page }) => {
    await page.locator('[aria-label="Open session"]').click();
    await expect(page.locator(".session-open-modal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".modal-title")).toHaveText("Open Session");
    await expect(page.locator(".terminal-ws-list")).toBeVisible({ timeout: 5000 });
  });

  test("Open Sessionはタブ無しで、Workspace / Sessions / Job のセクションを1つのリストに並べる", async ({ page }) => {
    await page.locator('[aria-label="Open session"]').click();
    await expect(page.locator(".session-open-modal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[role="tab"]')).toHaveCount(0);

    const titles = page.locator(".open-session-content > .settings-category-head .settings-category-title");
    await expect(titles).toContainText(["Workspace", "Sessions", "Job"]);
    await expect(page.locator(".terminal-ws-list")).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[aria-label="Add workspace"]')).toBeVisible();
    await expect(page.locator('[aria-label="New terminal"]')).toBeVisible();
    await expect(page.locator('[aria-label="Add job"]')).toBeVisible();
  });

  test("歯車ボタンでSettingsモーダルがSettingsMenuルートで開く", async ({ page }) => {
    await page.locator('[aria-label="Settings"]').click();
    await expect(page.locator(".terminal-settings-modal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });
  });

  test("Open SessionとSettingsは互いに排他（後から開いた方が前を閉じる）", async ({ page }) => {
    await page.locator('[aria-label="Open session"]').click();
    await expect(page.locator(".session-open-modal")).toBeVisible({ timeout: 5000 });

    await page.locator('[aria-label="Settings"]').click();
    await expect(page.locator(".terminal-settings-modal")).toBeVisible({ timeout: 5000 });
    // PCではsessionOpenとsettingsは排他のため、後から開いたSettingsでOpen Sessionは閉じる。
    await expect(page.locator(".session-open-modal")).toBeHidden({ timeout: 5000 });
  });

  test("Open Sessionから新規タブを作成するとモーダルが自動で閉じる", async ({ page }) => {
    await page.locator('[aria-label="Open session"]').click();
    await page.locator('[aria-label="New terminal"]').click();
    await expect(page.locator(".session-open-modal")).toBeHidden({ timeout: 10_000 });
  });

  test("Settings項目の内部（Terminal設定）へ掘り下げてもクラッシュせず戻れる", async ({ page }) => {
    await page.locator('[aria-label="Settings"]').click();
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });

    await openSettingsView(page, "Terminal");
    await expect(page.locator(".modal-title")).toContainText("Terminal", { timeout: 10_000 });

    await popToNavRoot(page);
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });
  });
});
