/**
 * ワークスペース登録・削除の E2E スモーク（登録・重複エラー・一覧表示・Delete 確認ダイアログ）。
 * テストが登録した分だけ後始末する。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, loadToken, login, deleteWorkspaceViaApi, openWorkspaces, openAddWorkspace, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.describe.configure({ mode: "serial" });

test.describe("workspace lifecycle", () => {
  /** @type {string} 一時ディレクトリ（= ワークスペースのパス） */
  let wsDir = "";
  /** @type {string} ワークスペース名（= ディレクトリ名。ユニーク） */
  let wsName = "";

  test.beforeAll(() => {
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-ws-"));
    wsName = path.basename(wsDir);
    fs.writeFileSync(path.join(wsDir, "README.md"), "# e2e workspace\n");
  });

  test.afterAll(async ({ request }) => {
    // UI 削除が失敗した場合に備え API でも後始末する。削除を確認せずディレクトリを消すと無効パスの登録がサーバに残るため、削除成功を確認してから消す。
    const token = loadToken();
    if (token && wsName) {
      await deleteWorkspaceViaApi(request, token, wsName);
    }
    if (wsDir) fs.rmSync(wsDir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);
  });

  test("Add Workspace でディレクトリを登録できる", async ({ page }) => {
    await openAddWorkspace(page);
    await expect(page.locator(".modal-title")).toHaveText("Add Workspace");

    await page.locator(".ws-add-input").fill(wsDir);
    await page.locator(".ws-add-submit-btn").click();

    // 登録成功後は Workspaces 一覧へ戻る（Settings → Workspaces → Add Workspace の1つ上）。
    await expect(page.locator(".modal-title")).toHaveText("Open Session", { timeout: 10_000 });
    await expect(page.locator(".ws-list-name", { hasText: wsName })).toBeVisible({ timeout: 10_000 });
  });

  test("Add Workspace 画面から Add group ダイアログを開ける", async ({ page }) => {
    await openAddWorkspace(page);
    await page.locator('[aria-label="Add group"]').click();
    await expect(page.locator(".ws-group-dialog")).toBeVisible({ timeout: 5000 });
    await page.locator(".ws-group-dialog .dialog-close-btn").click();
    await expect(page.locator(".ws-group-dialog")).toBeHidden({ timeout: 5000 });
  });

  test("Select jobボタンでジョブ選択ダイアログが開き、×で閉じる（一覧は展開しない）", async ({ page }) => {
    await openWorkspaces(page);
    const row = page.locator(".ws-list-item", { has: page.locator(".ws-list-header-label", { hasText: wsName }) });
    const jobDialog = page.locator(".ws-job-dialog");

    await expect(jobDialog).toHaveCount(0);
    await row.locator('[aria-label="Select job"]').click();
    await expect(jobDialog).toBeVisible({ timeout: 5000 });
    await expect(jobDialog.locator(".job-item-label", { hasText: "Terminal" })).toBeVisible();

    // Open Sessionは開いたまま（一覧のインライン展開はしない）
    await expect(page.locator(".modal-title")).toHaveText("Open Session");
    await expect(row.locator(".job-item-row")).toHaveCount(0);

    await jobDialog.locator(".dialog-close-btn").click();
    await expect(jobDialog).toHaveCount(0);
  });

  test("同じ名前の再登録はエラーになる", async ({ page }) => {
    await openAddWorkspace(page);

    await page.locator(".ws-add-input").fill(wsDir);
    await page.locator(".ws-add-submit-btn").click();
    await expect(page.locator(".form-message.error")).toContainText("already registered", { timeout: 5000 });
  });

  test("存在しないパスはエラーになる", async ({ page }) => {
    await openAddWorkspace(page);

    // 固定の絶対パスだと実在する環境で登録が成功しサーバ状態を汚すため、テスト管理下の wsDir 配下の未作成パスを使う。
    await page.locator(".ws-add-input").fill(path.join(wsDir, "e2e-missing-subdir"));
    await page.locator(".ws-add-submit-btn").click();
    await expect(page.locator(".form-message.error")).toContainText("Directory does not exist", { timeout: 5000 });
  });

  test("Workspaces 一覧に表示され、Edit から Delete できる（確認ダイアログあり）", async ({ page }) => {
    await openWorkspaces(page);
    await expect(page.locator(".modal-title")).toHaveText("Open Session");

    const row = page.locator(".ws-list-item", { has: page.locator(".ws-list-name", { hasText: wsName }) });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.locator('.ws-list-edit-btn[aria-label="Edit workspace"]').click();
    await expect(page.locator(".modal-title")).toHaveText(wsName);
    await page.locator('[aria-label="Add group"]').click();
    await expect(page.locator(".ws-group-dialog")).toBeVisible({ timeout: 5000 });
    await page.locator(".ws-group-dialog .dialog-close-btn").click();
    await expect(page.locator(".ws-group-dialog")).toBeHidden({ timeout: 5000 });
    await page.locator(".ws-delete-btn").click();

    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(`Delete "${wsName}"?`);
    await dialog.locator(".dialog-close-btn").click();
    await expect(dialog).toBeHidden();

    await page.locator(".ws-delete-btn").click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".toast", { hasText: `Deleted "${wsName}"` })).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".ws-list-name", { hasText: wsName })).toHaveCount(0, { timeout: 10_000 });
  });
});
