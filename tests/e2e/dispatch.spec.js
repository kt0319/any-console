/**
 * Dispatch（ワークスペース詳細の Dispatch タブ）の E2E スモーク。
 *
 * これまでdispatch機能自体のE2Eカバレッジが無かった（auth-devices.spec.jsは
 * dispatchスコープAPIトークンの作成/失効のみ）。POST /dispatch はメイン
 * トークン（cookie認証）でも受け付けるため、実際にキューへ投入してから
 * UIで一覧表示・Run・Discardを確認する。
 *
 * テスト用の git リポジトリを一時領域に作り、API でワークスペース登録して
 * から検証する。登録・作成したものはすべて afterAll で後始末する。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL, loadToken, bearerHeaders, deleteWorkspaceViaApi, useLoginWithSessionCleanup, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.describe.configure({ mode: "serial" });

test.describe("dispatch", () => {
  let wsDir = "";
  let wsName = "";

  test.beforeAll(async ({ request }) => {
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);

    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-dispatch-"));
    wsName = path.basename(wsDir);
    execFileSync("git", ["-C", wsDir, "init"], { stdio: "pipe" });
    fs.writeFileSync(path.join(wsDir, "README.md"), "# e2e dispatch repo\n");
    execFileSync("git", ["-C", wsDir, "add", "."], { stdio: "pipe" });
    execFileSync("git", ["-C", wsDir, "-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "commit", "-m", "e2e init"], { stdio: "pipe" });

    const res = await request.post(`${BASE_URL}/workspaces`, {
      headers: bearerHeaders(token),
      data: { path: wsDir },
    });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    const token = loadToken();
    if (token && wsName) await deleteWorkspaceViaApi(request, token, wsName);
    if (wsDir) fs.rmSync(wsDir, { recursive: true, force: true });
  });

  useLoginWithSessionCleanup(test);

  /** POST /dispatch でキューへ投入する（cookie認証で通る）。 */
  async function postDispatch(page, overrides = {}) {
    const res = await page.request.post(`${BASE_URL}/dispatch`, {
      data: { workspace: wsName, text: "echo dispatch-e2e", ...overrides },
    });
    expect(res.ok()).toBeTruthy();
  }

  /**
   * Dispatch タブを開く。"dispatch" はディープリンクのpaneクエリ対応外
   * （ui/composables/useDeepLink.ts の VALID_PANES。push通知タップ時の
   * pane:"dispatch" は別経路のためこの制約を受けない）のため、
   * workspace-panes.spec.jsと同じ手順でpane=filesとして開いてから
   * タブバーのDispatchボタンをクリックする。
   */
  async function openDispatchTab(page) {
    await page.goto(`/?ws=${encodeURIComponent(wsName)}&pane=files`);
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".modal-title")).toContainText(wsName, { timeout: 10_000 });
    await page.locator(".workspace-tabs").getByRole("button", { name: "Dispatch" }).click();
  }

  test("投入したdispatchがPending一覧に表示され、Runで新規セッションが作られてモーダルが閉じる", async ({ page }) => {
    await postDispatch(page);
    await openDispatchTab(page);

    const pendingRow = page.locator(".dispatch-queue-pending-row").first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });
    await pendingRow.click();

    // ボタンのアクセシブルネームにはmdiアイコンのグリフ文字も含まれる
    // （例: "󰐊 Run"）ため、末尾一致で判定する。
    const runBtn = page.getByRole("button", { name: /Run$/ });
    await expect(runBtn).toBeVisible({ timeout: 10_000 });
    await runBtn.click();

    // Run成功時はWorkspaceDetail.vueがモーダルごと閉じる（onDispatchRunDone参照）。
    await expect(page.locator(".modal-title")).toBeHidden({ timeout: 10_000 });
  });

  test("Discardで承認待ちが削除される（確認ダイアログあり）", async ({ page }) => {
    await postDispatch(page, { dedup_key: `e2e-discard-${Date.now()}` });
    await openDispatchTab(page);

    const pendingRow = page.locator(".dispatch-queue-pending-row").first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });
    await pendingRow.click();

    await page.getByRole("button", { name: /Discard dispatch/ }).click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator(".dialog-btn-ok").click();

    // 一覧へ戻り（emits("back")）、Pendingが無くなっていること。
    await expect(page.locator(".dispatch-queue-pending-row")).toHaveCount(0, { timeout: 10_000 });
  });
});
