/**
 * ワークスペース登録・削除の E2E スモーク。
 * Settings → Add Workspace からの登録、重複登録エラー、一覧表示、
 * Edit → Delete Workspace（確認ダイアログ = Confirm Rules）までの一連を確認する。
 *
 * テスト用ディレクトリは OS の一時領域に作り、テスト終了時に必ず削除する。
 * ワークスペース登録もテストが登録した分だけを後始末する（既存には触れない）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, loadToken, login, deleteWorkspaceViaApi, openWorkspaces, openAddWorkspace } from "./helpers.js";

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
    // UI 削除テストが失敗した場合に備えて API でも後始末する。
    // 削除を確認できないままディレクトリを消すと「消えたパスを指す登録」が
    // サーバに残るため、削除成功（または既に削除済み）を確認してから消す。
    const token = loadToken();
    if (token && wsName) {
      await deleteWorkspaceViaApi(request, token, wsName);
    }
    if (wsDir) fs.rmSync(wsDir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
  });

  test("Add Workspace でディレクトリを登録できる", async ({ page }) => {
    await openAddWorkspace(page);
    await expect(page.locator(".modal-title")).toHaveText("Add Workspace");

    await page.locator(".ws-add-input").fill(wsDir);
    await page.locator(".ws-add-btn").click();

    // 登録成功後は Workspaces 一覧へ戻る（Settings → Workspaces → Add Workspace の1つ上）。
    // 一覧に追加した名前が表示される
    await expect(page.locator(".modal-title")).toHaveText("Open Workspace", { timeout: 10_000 });
    await expect(page.locator(".picker-ws-name", { hasText: wsName })).toBeVisible({ timeout: 10_000 });
  });

  test("ワークスペース名クリックでJobsがインライン展開・再クリックで閉じる", async ({ page }) => {
    await openWorkspaces(page);
    const row = page.locator(".picker-ws-group", { has: page.locator(".picker-ws-header-label", { hasText: wsName }) });
    const jobsInline = row.locator(".picker-ws-jobs-inline");

    await expect(jobsInline).toHaveCount(0);
    await row.locator(".picker-ws-header-label").click();
    await expect(jobsInline).toBeVisible({ timeout: 5000 });
    await expect(jobsInline.locator(".job-item-label", { hasText: "Terminal" })).toBeVisible();

    // モーダルは開かない（Jobsのインライン展開のみ）
    await expect(page.locator(".modal-title")).toHaveText("Open Workspace");

    await row.locator(".picker-ws-header-label").click();
    await expect(jobsInline).toHaveCount(0);
  });

  test("同じ名前の再登録はエラーになる", async ({ page }) => {
    await openAddWorkspace(page);

    await page.locator(".ws-add-input").fill(wsDir);
    await page.locator(".ws-add-btn").click();
    await expect(page.locator(".form-message.error")).toContainText("already registered", { timeout: 5000 });
  });

  test("存在しないパスはエラーになる", async ({ page }) => {
    await openAddWorkspace(page);

    // テスト管理下の wsDir 配下で「作っていない」子パスを使う。
    // 固定の絶対パスだと実在する環境で登録が成功しサーバ状態を汚してしまう。
    await page.locator(".ws-add-input").fill(path.join(wsDir, "e2e-missing-subdir"));
    await page.locator(".ws-add-btn").click();
    await expect(page.locator(".form-message.error")).toContainText("Directory does not exist", { timeout: 5000 });
  });

  test("Workspaces 一覧に表示され、Edit から Delete できる（確認ダイアログあり）", async ({ page }) => {
    await openWorkspaces(page);
    await expect(page.locator(".modal-title")).toHaveText("Open Workspace");

    const row = page.locator(".picker-ws-group", { has: page.locator(".picker-ws-name", { hasText: wsName }) });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Edit → Delete Workspace（Editボタンはワークスペース一覧のEditモード中のみ表示）
    await page.locator('[aria-label="Edit workspaces"]').click();
    await row.locator('.picker-ws-edit-btn[aria-label="Edit workspace"]').click();
    await expect(page.locator(".modal-title")).toHaveText(wsName);
    await page.locator(".ws-delete-btn").click();

    // Cancel では消えない
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(`Delete "${wsName}"?`);
    await dialog.locator(".dialog-btn-cancel").click();
    await expect(dialog).toBeHidden();

    // OK で削除され、一覧から消える
    await page.locator(".ws-delete-btn").click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".toast", { hasText: `Deleted "${wsName}"` })).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".picker-ws-name", { hasText: wsName })).toHaveCount(0, { timeout: 10_000 });
  });
});
