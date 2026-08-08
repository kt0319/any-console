/**
 * Sessionsページ下部メニュー（Open / Dispatches / Server / Settings）の
 * E2E スモーク。各項目は本物のcurrentView遷移（WorkspaceOpen/SessionDispatches/
 * SessionPreview/ModalMenu）で、Sessionsページを離れるとメニューごと消える
 * （SessionListView.vueがアンマウントされるため）。
 */
import { test, expect, loadToken, login, openSettingsModal, openSettingsView, listSessionIds, cleanupNewSessions } from "./helpers.js";

/** 設定モーダルを開き、ルートビュー（Sessions）まで遡る。 */
async function openSessionsRoot(page) {
  await openSettingsModal(page);
  while (await page.locator(".modal-title-wrap.is-clickable").count()) {
    await page.locator(".modal-title-wrap").click();
  }
}

test.describe("session list menu", () => {
  /** @type {string[] | null} テスト開始時点のセッション ID（後始末で増分だけ消す。null = 未取得） */
  let sessionIdsBefore = null;

  test.beforeEach(async ({ page, context }) => {
    sessionIdsBefore = null;
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  test("Dispatches / Server 項目に遷移でき、タイトルも連動する", async ({ page }) => {
    await openSessionsRoot(page);
    await expect(page.locator(".modal-title")).toContainText("Sessions");

    await page.locator(".session-list-menu .settings-menu-item", { hasText: "Dispatches" }).click();
    await expect(page.locator(".dispatch-queue-tab")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".modal-title")).toContainText("Dispatches");

    // 戻ってSessionsルートから今度はServerへ
    await page.locator(".modal-title-wrap").click();
    await page.locator(".session-list-menu .settings-menu-item", { hasText: "Server" }).click();
    await expect(page.locator(".preview-tab")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".modal-title")).toContainText("Server");
  });

  test("Open / Settings 項目に遷移でき、Sessionsページを離れるとメニューが消える", async ({ page }) => {
    await openSessionsRoot(page);

    await page.locator(".session-list-menu .settings-menu-item", { hasText: "Settings" }).click();
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".session-list-menu")).toHaveCount(0);

    await page.locator(".modal-title-wrap").click();
    await page.locator(".session-list-menu .settings-menu-item", { hasText: "Open" }).click();
    await expect(page.locator(".terminal-ws-list")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".session-list-menu")).toHaveCount(0);
    await expect(page.locator(".modal-title")).toContainText("Open Session");
  });

  test("Openから新規タブを作成するとSessionsページへ自動で戻る", async ({ page }) => {
    await openSessionsRoot(page);
    await page.locator(".session-list-menu .settings-menu-item", { hasText: "Open" }).click();
    await expect(page.locator(".terminal-ws-list")).toBeVisible({ timeout: 5000 });

    await page.locator('[aria-label="New terminal"]').click();
    await expect(page.locator(".modal-title")).toContainText("Sessions", { timeout: 10_000 });
    await expect(page.locator(".session-list-menu")).toBeVisible();
  });

  test("Settings項目の内部（Terminal設定）へ掘り下げてもクラッシュしない", async ({ page }) => {
    await openSessionsRoot(page);
    await page.locator(".session-list-menu .settings-menu-item", { hasText: "Settings" }).click();
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });

    await openSettingsView(page, "Terminal");
    await expect(page.locator(".modal-title")).toContainText("Terminal", { timeout: 10_000 });

    // タイトルの戻るボタンでSettingsメニューへ戻れる
    await page.locator(".modal-title-wrap").click();
    await expect(page.locator(".settings-menu")).toBeVisible({ timeout: 5000 });
  });
});
