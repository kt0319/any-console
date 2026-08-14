/**
 * worktreeのセッション連動E2E。
 *
 * 回帰対象: worktree削除（Branchesタブの「Remove worktree」ボタン、
 * ui/composables/useBranchActions.ts の removeWorktree）で、そのworktreeを
 * 開いているセッションのタブが確認の上で閉じることを検証する。
 * これはユニットテスト（findOpenTabsForWorktree単体）だけでは検出できない
 * バグだった — /worktrees API由来のwtオブジェクトはworkspace/nameフィールドを
 * 持たず、呼び出し側で "base [branch]" 形式を組み立てないとタブが常に
 * 見つからなかった（実際には一度もタブが閉じていなかった）。
 *
 * テスト用の git リポジトリを一時領域に作り、API（Bearer 認証）で
 * ワークスペース登録・worktree作成してから UI で削除操作を検証する。
 * 登録・作成したものはすべて afterAll で後始末する。
 */
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

    // worktree自体はAPIで直接作る（UI経由のAdd worktreeダイアログは
    // GitChangeBranch.vueの別テストで既に検証済みのため、ここではUIの
    // 検証対象を削除操作に絞る）。
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
    // Open Session一覧のworktree行からTerminalを起動し、そのworktreeの
    // セッションタブを開いておく。
    const tabs = page.locator(".tab-btn");
    const tabCountBefore = await tabs.count();
    // タブ名はworktreeでもベース名のみ（TabItem.vue、ブランチは出さない）だが、
    // wsNameはこのテスト専用の一時ディレクトリ名で他の実タブと衝突しない。
    const worktreeTab = page.locator(".tab-btn", { hasText: wsName });

    await openWorkspaces(page);
    const wtRow = page.locator(".picker-ws-worktree-item", { has: page.locator(".picker-ws-worktree-branch", { hasText: WORKTREE_BRANCH }) });
    await expect(wtRow).toBeVisible({ timeout: 10_000 });
    await wtRow.locator(".picker-ws-worktree-open").click();
    // WorkspaceJobsPane（Terminal項目）は.picker-ws-worktree-itemの兄弟要素
    // として展開されるため、wtRowの外（直後の.picker-ws-jobs-inline）を見る。
    await wtRow.locator("xpath=following-sibling::div[contains(@class,'picker-ws-jobs-inline')][1]").locator(".job-item", { hasText: "Terminal" }).click();

    await expect(tabs).toHaveCount(tabCountBefore + 1, { timeout: 10_000 });
    await expect(worktreeTab).toBeVisible({ timeout: 10_000 });
    const term = page.locator(".xterm >> visible=true").first();
    await expect(term).toBeVisible({ timeout: 10_000 });

    // ベースワークスペースのHistory > Branchesから、worktreeにリンクされた
    // ブランチ行のRemove worktreeボタンを押す。
    await page.goto(`/?ws=${encodeURIComponent(wsName)}&pane=history`);
    const confirmDialog = page.locator(".confirm-dialog");
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".modal-title")).toContainText(wsName, { timeout: 10_000 });
    await page.locator(".branch-item.current").click();

    const branchRow = page.locator(".branch-item", { has: page.locator(".branch-item-name", { hasText: WORKTREE_BRANCH }) });
    await expect(branchRow).toBeVisible({ timeout: 10_000 });
    await expect(branchRow.locator(".branch-worktree-icon")).toBeVisible();

    await branchRow.locator('[aria-label="Remove worktree"]').click();
    const removeDialog = page.locator(".confirm-dialog");
    await expect(removeDialog).toBeVisible({ timeout: 5000 });
    // 開いているセッションが閉じられることを確認文言で明示している
    // （removeWorktreeConfirmMessage、ui/utils/worktree.ts）。
    await expect(removeDialog).toContainText("Its open session will also be closed.");
    await removeDialog.locator(".dialog-btn-ok").click();

    await expect(branchRow).toBeHidden({ timeout: 10_000 });

    // このバグの本丸: worktreeを開いていたタブが実際に閉じること。
    await expect(worktreeTab).toHaveCount(0, { timeout: 10_000 });
    await expect(tabs).toHaveCount(tabCountBefore, { timeout: 10_000 });
  });
});
