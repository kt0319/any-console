/**
 * 設定モーダルの全ビューの E2E スモーク。
 * すべてのメニュー項目が開けて（各ビューがマウント時にクラッシュしない）、
 * タイトル（戻るボタン）でメニューへ戻れることを確認する。
 * Auth / Config File / System Info は代表的な表示内容も検証する（読み取りのみ・状態変更なし）。
 */
import { test, expect, loadToken, login, openSettingsModal, openSettingsView, openAddWorkspace } from "./helpers.js";

// メニューラベル → 遷移後のモーダルタイトル
// Add Workspace は Settings 直下ではなく Workspaces 一覧の「+」から開くため、
// この一覧（Settings → 各ビュー → 戻る、の1階層ループ）には含めない。
const SETTINGS_VIEWS = [
  ["Workspaces", "Workspaces"],
  ["Tabs & Sessions", "Tabs & Sessions"],
  ["Terminal", "Terminal"],
  ["Editor", "Editor"],
  ["Display", "Display"],
  ["Send Snippet", "Send Snippet"],
  ["Send History", "Send History"],
  ["Circle Keypad", "Circle Keypad"],
  ["Dev Server Preview", "Dev Server Preview"],
  ["Notifications", "Notifications"],
  ["Auth", "Auth"],
  ["Config File", "Config File"],
  ["System Info", "System Info"],
];

test.describe("settings views", () => {
  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    await openSettingsModal(page);
  });

  test("すべてのメニュー項目が開けてメニューへ戻れる", async ({ page }) => {
    for (const [label, title] of SETTINGS_VIEWS) {
      await openSettingsView(page, label);
      await expect(page.locator(".modal-title")).toContainText(title, { timeout: 10_000 });
      // タイトル（戻るボタン）でメニューへ戻る
      await page.locator(".modal-title-wrap").click();
      await expect(page.locator(".modal-title")).toHaveText("Settings", { timeout: 5000 });
    }
  });

  test("Workspaces の「+」から Add Workspace が開いて戻れる", async ({ page }) => {
    await openAddWorkspace(page);
    await expect(page.locator(".modal-title")).toHaveText("Add Workspace", { timeout: 10_000 });
    await page.locator(".modal-title-wrap").click();
    await expect(page.locator(".modal-title")).toHaveText("Workspaces", { timeout: 5000 });
  });

  test("Auth ビューにトークン設定状態と自デバイスが表示される", async ({ page }) => {
    await openSettingsView(page, "Auth");
    await expect(page.locator(".modal-title")).toHaveText("Auth", { timeout: 10_000 });

    // トークン認証が有効なサーバ（E2E 前提）では configured 表示になる
    await expect(page.locator(".settings-toggle", { hasText: "Require token authentication" })).toBeVisible();
    await expect(page.locator(".security-token-status.configured")).toBeVisible({ timeout: 10_000 });

    // ログインに使ったこのデバイスが Trusted Devices に載る
    const currentDevice = page.locator(".device-row", { has: page.locator(".device-tag", { hasText: "This device" }) });
    await expect(currentDevice).toBeVisible({ timeout: 10_000 });
  });

  test("Config File ビューに設定 JSON が表示される", async ({ page }) => {
    await openSettingsView(page, "Config File");
    await expect(page.locator(".modal-title")).toHaveText("Config File", { timeout: 10_000 });
    await expect(page.locator(".config-file-code")).toBeVisible({ timeout: 10_000 });
    // Download / Upload の操作ボタンが提供されている
    await expect(page.locator(".config-file-btn", { hasText: "Download" })).toBeVisible();
    await expect(page.locator(".config-file-btn", { hasText: "Upload" })).toBeVisible();
  });

  test("System Info ビューにホスト名が表示される", async ({ page }) => {
    const infoRes = await page.request.get("/system/info");
    const info = infoRes.ok() ? await infoRes.json() : null;
    test.skip(!info?.hostname, "system/info からホスト名が取れない");

    await openSettingsView(page, "System Info");
    await expect(page.locator(".modal-title")).toContainText("System Info", { timeout: 10_000 });
    await expect(page.locator(".modal-body")).toContainText(info.hostname, { timeout: 10_000 });
  });
});
