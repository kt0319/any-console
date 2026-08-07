/**
 * Sessionsページのタブ帯（Sessions / Open / Dispatches / Settings）の
 * E2E スモーク。タブ帯はSettingsPanel.vueの常設表示で、各タブは本物のcurrentView
 * 遷移（SessionList/WorkspaceOpen/SessionDispatches/ModalMenu）に
 * なっているため、Settingsタブから内部（Terminal等）へさらに一段掘り下げても
 * タブ帯が消えないことを確認する。
 */
import { test, expect, loadToken, login, openSettingsModal, openSettingsView } from "./helpers.js";

/** 設定モーダルを開き、ルートビュー（Sessions）まで遡る。 */
async function openSessionsRoot(page) {
  await openSettingsModal(page);
  while (await page.locator(".modal-title-wrap.is-clickable").count()) {
    await page.locator(".modal-title-wrap").click();
  }
}

test.describe("session tabs", () => {
  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
  });

  test("Dispatches タブに切り替えられ、タイトルも連動する", async ({ page }) => {
    await openSessionsRoot(page);

    await expect(page.locator(".session-tab", { hasText: "Sessions" })).toHaveClass(/active/);
    await expect(page.locator(".session-list-scroll")).toBeVisible();
    await expect(page.locator(".modal-title")).toContainText("Sessions");

    await page.locator(".session-tab", { hasText: "Dispatches" }).click();
    await expect(page.locator(".dispatch-queue-tab")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".session-tabs")).toBeVisible();
    await expect(page.locator(".modal-title")).toContainText("Dispatches");

    await page.locator(".session-tab", { hasText: "Sessions" }).click();
    await expect(page.locator(".session-list-scroll")).toBeVisible();
    await expect(page.locator(".modal-title")).toContainText("Sessions");
  });

  test("Open / Settings タブに切り替えてもタブ帯が消えない", async ({ page }) => {
    await openSessionsRoot(page);

    await page.locator(".session-tab", { hasText: "Settings" }).click();
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".session-tabs")).toBeVisible();
    await expect(page.locator(".session-tab", { hasText: "Settings" })).toHaveClass(/active/);

    await page.locator(".session-tab", { hasText: "Open" }).click();
    await expect(page.locator(".terminal-ws-list")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".session-tabs")).toBeVisible();
    await expect(page.locator(".modal-title")).toContainText("Open Workspace");

    await page.locator(".session-tab", { hasText: "Sessions" }).click();
    await expect(page.locator(".session-list-scroll")).toBeVisible();
  });

  test("Settingsタブの内部（Terminal設定）へ掘り下げてもタブ帯が消えない", async ({ page }) => {
    await openSessionsRoot(page);
    await page.locator(".session-tab", { hasText: "Settings" }).click();
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });

    await openSettingsView(page, "Terminal");
    await expect(page.locator(".modal-title")).toContainText("Terminal", { timeout: 10_000 });
    await expect(page.locator(".session-tabs")).toBeVisible();
    await expect(page.locator(".session-tab", { hasText: "Settings" })).toHaveClass(/active/);

    // タブ帯から直接他タブへ切り替えられる（掘り下げた分の状態は破棄される）
    await page.locator(".session-tab", { hasText: "Sessions" }).click();
    await expect(page.locator(".session-list-scroll")).toBeVisible();
  });
});
