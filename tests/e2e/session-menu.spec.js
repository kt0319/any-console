/**
 * タブバーの「+」（Open Session）/ 歯車（Settings）ボタンの E2E スモーク。
 * どちらもセッション一覧サイドバーとは独立した全面オーバーレイ
 * （SessionOpenModal.vue / TerminalSettingsModal.vue）として、本物の
 * currentView遷移（WorkspaceOpen/ModalMenu）で開く。
 */
import { test, expect, openSettingsView, popToNavRoot, useLoginWithSessionCleanup } from "./helpers.js";

test.describe("tab bar: open session / settings buttons", () => {
  useLoginWithSessionCleanup(test);

  test("+ボタンでOpen SessionモーダルがWorkspaceOpenルートで開く", async ({ page }) => {
    await page.locator('[aria-label="Open session"]').click();
    await expect(page.locator(".session-open-modal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".modal-title")).toHaveText("Open Session");
    await expect(page.locator(".terminal-ws-list")).toBeVisible({ timeout: 5000 });
  });

  test("歯車ボタンでSettingsモーダルがModalMenuルートで開く", async ({ page }) => {
    await page.locator('[aria-label="Settings"]').click();
    await expect(page.locator(".terminal-settings-modal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });
  });

  test("Open SessionとSettingsは互いに排他（後から開いた方が前を閉じる）", async ({ page }) => {
    await page.locator('[aria-label="Open session"]').click();
    await expect(page.locator(".session-open-modal")).toBeVisible({ timeout: 5000 });

    await page.locator('[aria-label="Settings"]').click();
    await expect(page.locator(".terminal-settings-modal")).toBeVisible({ timeout: 5000 });
    // PCではsessionOpen/settingsは互いに排他のため、後から開いたSettingsで
    // Open Sessionは自動的に閉じる。
    await expect(page.locator(".session-open-modal")).toBeHidden({ timeout: 5000 });
  });

  test("Open Sessionから新規タブを作成するとモーダルが自動で閉じる", async ({ page }) => {
    await page.locator('[aria-label="Open session"]').click();
    await expect(page.locator(".terminal-ws-list")).toBeVisible({ timeout: 5000 });

    await page.locator('[aria-label="New terminal"]').click();
    await expect(page.locator(".session-open-modal")).toBeHidden({ timeout: 10_000 });
  });

  test("Settings項目の内部（Terminal設定）へ掘り下げてもクラッシュせず戻れる", async ({ page }) => {
    await page.locator('[aria-label="Settings"]').click();
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });

    await openSettingsView(page, "Terminal");
    await expect(page.locator(".modal-title")).toContainText("Terminal", { timeout: 10_000 });

    // タイトルの戻るボタンでSettingsメニューへ戻れる
    await popToNavRoot(page);
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });
  });
});
