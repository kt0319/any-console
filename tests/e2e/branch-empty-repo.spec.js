/**
 * コミット0（unborn branch）のリポジトリでも、Historyペイン内のBranchesに現在ブランチが
 * 表示されることのE2E。`git branch` が空を返すため、サーバが現在ブランチを補う。
 * 登録・作成したものはすべて afterAll で後始末する。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL, loadToken, bearerHeaders, deleteWorkspaceViaApi, useLoginWithSessionCleanup, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.describe.configure({ mode: "serial" });

test.describe("コミット0のリポジトリのBranches", () => {
  let rootDir = "";
  let wsDir = "";
  let wsName = "";

  test.beforeAll(async ({ request }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);

    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-empty-"));
    wsDir = path.join(rootDir, "empty-repo");
    fs.mkdirSync(wsDir);
    execFileSync("git", ["init", "-q", "-b", "main", wsDir]);
    wsName = path.basename(wsDir);

    const res = await request.post(`${BASE_URL}/workspaces`, {
      headers: bearerHeaders(token),
      data: { path: wsDir },
    });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    const token = loadToken();
    if (token && wsName) {
      await deleteWorkspaceViaApi(request, token, wsName);
    }
    if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
  });

  useLoginWithSessionCleanup(test);

  test("コミット0でも現在ブランチの行が表示される", async ({ page }) => {
    const res = await page.request.post("/run", { data: { job: "terminal", workspace: wsName } });
    expect(res.ok()).toBeTruthy();

    await page.goto(`/?ws=${encodeURIComponent(wsName)}&pane=history`);
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".modal-title")).toContainText(wsName, { timeout: 10_000 });

    await expect(page.locator(".text-muted-center", { hasText: "No commit history" })).toBeVisible({ timeout: 10_000 });
    const currentBranch = page.locator(".branch-item.current");
    await expect(currentBranch).toBeVisible({ timeout: 10_000 });
    await expect(currentBranch).toContainText("main");
  });
});
