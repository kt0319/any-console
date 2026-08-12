/**
 * ブランチモーダル（Historyペイン内のBranches）からのpush/pullで、開いたままの
 * Historyペインのコミット一覧が（ページ遷移なしに）更新されることのE2E。
 *
 * bareリモート + 2クローン（wsDir=登録するワークスペース、otherCloneDir=
 * 別クローン。ここから新規コミットをpushして「他者の変更」を模す）を用意する。
 * 登録・作成したものはすべて afterAll で後始末する。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL, loadToken, bearerHeaders, deleteWorkspaceViaApi, useLoginWithSessionCleanup, TOKEN_REQUIRED_MSG } from "./helpers.js";

const COMMIT_MSG_INITIAL = "feat: e2e リモート初期コミット";
const COMMIT_MSG_REMOTE = "feat: 他クローンから積んだ新規コミット";

function git(dir, ...args) {
  execFileSync("git", ["-C", dir, "-c", "user.email=e2e@example.com", "-c", "user.name=e2e", ...args], {
    stdio: "pipe",
  });
}

test.describe.configure({ mode: "serial" });

test.describe("branch modal push/pull と History の連動", () => {
  let remoteDir = "";
  let wsDir = "";
  let otherCloneDir = "";
  let wsName = "";

  test.beforeAll(async ({ request }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-remote-"));
    remoteDir = path.join(root, "remote.git");
    fs.mkdirSync(remoteDir);
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remoteDir]);

    // wsDir: 登録するワークスペース（UIから開いてpush/pullする側）
    wsDir = path.join(root, "workspace");
    execFileSync("git", ["clone", "-q", remoteDir, wsDir]);
    git(wsDir, "config", "user.email", "e2e@example.com");
    git(wsDir, "config", "user.name", "e2e");
    fs.writeFileSync(path.join(wsDir, "README.md"), "# e2e remote repo\n");
    git(wsDir, "add", ".");
    git(wsDir, "commit", "-m", COMMIT_MSG_INITIAL);
    git(wsDir, "push", "-q", "origin", "main");
    wsName = path.basename(wsDir);

    // otherCloneDir: 別クローン。ここからpushして「他者の新規コミット」を模す
    otherCloneDir = path.join(root, "other-clone");
    execFileSync("git", ["clone", "-q", remoteDir, otherCloneDir]);
    git(otherCloneDir, "config", "user.email", "e2e-other@example.com");
    git(otherCloneDir, "config", "user.name", "e2e-other");

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
    if (remoteDir) fs.rmSync(path.dirname(remoteDir), { recursive: true, force: true });
  });

  useLoginWithSessionCleanup(test);

  /** Historyペインを開いたまま（?pane=history直リンク）にする。 */
  async function openHistoryPane(page) {
    await page.goto(`/?ws=${encodeURIComponent(wsName)}&pane=history`);
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".modal-title")).toContainText(wsName, { timeout: 10_000 });
    await expect(page.locator(".git-log-entry-msg", { hasText: COMMIT_MSG_INITIAL })).toBeVisible({ timeout: 10_000 });
  }

  test("Pull後、開いたままのHistoryペインに新しいコミットが表示される", async ({ page }) => {
    // 他クローンから新規コミットをpush（wsDir側はまだ知らない = behind になる）
    fs.writeFileSync(path.join(otherCloneDir, "remote-change.txt"), "from other clone\n");
    git(otherCloneDir, "add", ".");
    git(otherCloneDir, "commit", "-m", COMMIT_MSG_REMOTE);
    git(otherCloneDir, "push", "-q", "origin", "main");

    await openHistoryPane(page);

    // 現在ブランチ行にPullボタン（behind > 0で表示）がある
    const pullBtn = page.locator(".branch-item.current .pull-btn");
    await expect(pullBtn).toBeVisible({ timeout: 10_000 });
    await pullBtn.click();

    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText("pull");
    await dialog.locator(".dialog-btn-ok").click();

    await expect(page.locator(".toast", { hasText: "Pulled" })).toBeVisible({ timeout: 10_000 });

    // ページ遷移・タブ再クリックなしに、同じHistoryペインへ新規コミットが反映される
    await expect(page.locator(".git-log-entry-msg", { hasText: COMMIT_MSG_REMOTE })).toBeVisible({ timeout: 10_000 });

    // Pullボタンはbehindが解消されて消える
    await expect(pullBtn).not.toBeVisible({ timeout: 10_000 });
  });

  test("Push後、Pushボタン（ahead件数）が解消される", async ({ page }) => {
    // ローカルにコミットを積む（ahead > 0にする）
    fs.appendFileSync(path.join(wsDir, "README.md"), "\nlocal change\n");
    git(wsDir, "add", ".");
    git(wsDir, "commit", "-m", "test: e2e ローカルコミット (push確認用)");

    await openHistoryPane(page);

    const pushBtn = page.locator(".branch-item.current .push-btn");
    await expect(pushBtn).toBeVisible({ timeout: 10_000 });
    await pushBtn.click();

    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText("push");
    await dialog.locator(".dialog-btn-ok").click();

    await expect(page.locator(".toast", { hasText: "Pushed" })).toBeVisible({ timeout: 10_000 });
    await expect(pushBtn).not.toBeVisible({ timeout: 10_000 });
  });
});
