/** worktree 削除時に、その worktree を開いているセッションのタブが確認の上で閉じることの E2E。
 * /worktrees API 由来の wt は workspace/name を持たず、呼び出し側で "base [branch]" を組み立てないとタブが見つからなかった回帰を検証する。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL, loadToken, bearerHeaders, deleteWorkspaceViaApi, openWorkspaces, useLoginWithSessionCleanup, TOKEN_REQUIRED_MSG } from "./helpers.js";

const COMMIT_MSG_INITIAL = "feat: e2e worktree 初期コミット";
const WORKTREE_BRANCH = "feature/e2e-worktree";

function git(dir, ...args) {
  execFileSync("git", ["-C", dir, "-c", "user.email=e2e@example.com", "-c", "user.name=e2e", ...args], {
    stdio: "pipe",
  });
}

test.describe.configure({ mode: "serial" });

test.describe("worktree削除とセッションタブの連動", () => {
  let wsDir = "";
  let wsName = "";
  let worktreeWsName = "";

  test.beforeAll(async ({ request }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);

    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-wt-"));
    git(wsDir, "init");
    git(wsDir, "config", "user.email", "e2e@example.com");
    git(wsDir, "config", "user.name", "e2e");
    fs.writeFileSync(path.join(wsDir, "README.md"), "# e2e worktree repo\n");
    git(wsDir, "add", ".");
    git(wsDir, "commit", "-m", COMMIT_MSG_INITIAL);
    wsName = path.basename(wsDir);

    const res = await request.post(`${BASE_URL}/workspaces`, {
      headers: bearerHeaders(token),
      data: { path: wsDir },
    });
    expect(res.ok()).toBeTruthy();

    // UI 経由の Add worktree は GitChangeBranch.vue の別テストで検証済みのため API で作る
    const wtRes = await request.post(`${BASE_URL}/workspaces/${encodeURIComponent(wsName)}/worktrees`, {
      headers: bearerHeaders(token),
      data: { branch: WORKTREE_BRANCH },
    });
    expect(wtRes.ok()).toBeTruthy();
    worktreeWsName = `${wsName} [${WORKTREE_BRANCH}]`;
  });

  test.afterAll(async ({ request }) => {
    const token = loadToken();
    if (token && wsName) {
      await deleteWorkspaceViaApi(request, token, wsName);
    }
    if (wsDir) fs.rmSync(wsDir, { recursive: true, force: true });
  });

  useLoginWithSessionCleanup(test);

  test("Branchesタブでworktreeを削除すると、そのworktreeを開いていたセッションのタブも閉じる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const tabCountBefore = await tabs.count();
    // タブ名は worktree でもベース名のみ（TabItem.vue）。wsName は一時ディレクトリ名で他タブと衝突しない
    const worktreeTab = page.locator(".tab-btn", { hasText: wsName });

    await openWorkspaces(page);
    const wtRow = page.locator(".ws-list-worktree-item", { has: page.locator(".ws-list-worktree-branch", { hasText: WORKTREE_BRANCH }) });
    await expect(wtRow).toBeVisible({ timeout: 10_000 });
    await wtRow.locator(".ws-list-worktree-open").click();
    await page.locator(".ws-job-dialog .job-item", { hasText: "Terminal" }).click();

    await expect(tabs).toHaveCount(tabCountBefore + 1, { timeout: 10_000 });
    await expect(worktreeTab).toBeVisible({ timeout: 10_000 });
    const term = page.locator(".xterm >> visible=true").first();
    await expect(term).toBeVisible({ timeout: 10_000 });

    await page.goto(`/?ws=${encodeURIComponent(wsName)}&pane=history`);
    const confirmDialog = page.locator(".confirm-dialog");
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".modal-title")).toContainText(wsName, { timeout: 10_000 });
    await page.locator(".branch-item.current").click();

    const branchRow = page.locator(".branch-item", { has: page.locator(".branch-item-name", { hasText: WORKTREE_BRANCH }) });
    await expect(branchRow).toBeVisible({ timeout: 10_000 });
    await expect(branchRow.locator(".branch-worktree-icon")).toBeVisible();

    await branchRow.locator('[aria-label="Delete branch"]').click();
    const removeDialog = page.locator(".confirm-dialog");
    await expect(removeDialog).toBeVisible({ timeout: 5000 });
    await expect(removeDialog).toContainText("Its open session will also be closed.");
    await removeDialog.locator(".confirm-btn-extra2").click();

    await expect(branchRow).toBeHidden({ timeout: 10_000 });

    await expect(worktreeTab).toHaveCount(0, { timeout: 10_000 });
    await expect(tabs).toHaveCount(tabCountBefore, { timeout: 10_000 });
  });
});
