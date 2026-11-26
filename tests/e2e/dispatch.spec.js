/** Dispatch（ワークスペース詳細の Dispatch タブ）の E2E スモーク。実際にキュー投入し、一覧表示・Run・Discard を確認する。 */
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

  async function postDispatch(page, overrides = {}) {
    const res = await page.request.post(`${BASE_URL}/dispatch`, {
      data: { workspace: wsName, text: "echo dispatch-e2e", ...overrides },
    });
    expect(res.ok()).toBeTruthy();
  }

  // 1x1 transparent PNG（アップロード可能な最小の有効な画像バイナリ）。
  const TINY_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  async function uploadImage(page, filename = "e2e.png") {
    const res = await page.request.post(`${BASE_URL}/upload-image`, {
      multipart: {
        file: {
          name: filename,
          mimeType: "image/png",
          buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
        },
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    return data.path;
  }

  /** "dispatch" は deep link の pane 対象外（useDeepLink.ts の VALID_PANES）のため、pane=files で開いてタブバーから切り替える。 */
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

    // アクセシブルネームに mdi グリフが含まれるため末尾一致で判定する
    const runBtn = page.getByRole("button", { name: /Run$/ });
    await expect(runBtn).toBeVisible({ timeout: 10_000 });
    await runBtn.click();

    // Run成功時はWorkspaceDetail.vueがモーダルごと閉じる（onDispatchRunDone参照）。
    await expect(page.locator(".modal-title")).toBeHidden({ timeout: 10_000 });
  });

  test("Runが失敗しても画面は閉じずRerunモードになり、履歴にfailedとして残る", async ({ page }) => {
    await postDispatch(page, { dedup_key: `e2e-failed-${Date.now()}` });
    await openDispatchTab(page);

    const pendingRow = page.locator(".dispatch-queue-pending-row").first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });
    await pendingRow.click();
    const runBtn = page.getByRole("button", { name: /Run$/ });
    await expect(runBtn).toBeEnabled({ timeout: 10_000 });

    // launch 時にワークスペースのパス解決が失敗するよう、Run直前にディレクトリを退避する。
    const movedDir = `${wsDir}-moved`;
    fs.renameSync(wsDir, movedDir);
    try {
      await runBtn.click();
      await expect(page.locator(".dispatch-run-title")).toHaveText("Rerun Dispatch", { timeout: 10_000 });
    } finally {
      fs.renameSync(movedDir, wsDir);
    }

    await page.getByRole("button", { name: "Back to dispatch list" }).click();
    await expect(page.locator(".dispatch-queue-recent-failed").first()).toBeVisible({ timeout: 10_000 });
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

    await expect(page.locator(".dispatch-queue-pending-row")).toHaveCount(0, { timeout: 10_000 });
  });

  test("一覧の×ボタンで確認の上、承認待ちを破棄できる（詳細画面を開かない）", async ({ page }) => {
    await postDispatch(page, { dedup_key: `e2e-list-discard-${Date.now()}` });
    await openDispatchTab(page);

    const pendingRow = page.locator(".dispatch-queue-pending-row").first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });
    const discardBtn = page.locator('.dispatch-queue-row [aria-label="Discard dispatch"]').first();

    await discardBtn.click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText("Discard dispatch");
    await dialog.locator(".dialog-close-btn").click();
    await expect(dialog).toBeHidden();
    await expect(pendingRow).toBeVisible();

    await discardBtn.click();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".dispatch-queue-pending-row")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(".dispatch-run-title")).toHaveCount(0);
  });

  test("画像添付dispatchのRunで、Image:行が実際にターミナルへ流し込まれる（受付〜CLI側読取のE2E）", async ({ page }) => {
    const imagePath = await uploadImage(page);
    await postDispatch(page, {
      text: "",
      image_paths: [imagePath],
      dedup_key: `e2e-image-${Date.now()}`,
    });
    await openDispatchTab(page);

    const pendingRow = page.locator(".dispatch-queue-pending-row").first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });
    await pendingRow.click();

    const runBtn = page.getByRole("button", { name: /Run$/ });
    await expect(runBtn).toBeVisible({ timeout: 10_000 });
    await runBtn.click();
    await expect(page.locator(".modal-title")).toBeHidden({ timeout: 10_000 });

    // Run 成功時は新規セッションのターミナルタブへ自動遷移する（useDispatchQueue.ts の focusSession）。
    // 実 CLI は起動せず、compose_text_with_images（server/src/dispatch.rs）が組み立てた `Image: <path>` 行がシェルのエコーバックに出ることで確認する。
    const imageName = imagePath.split("/").pop();
    const term = page.locator(".xterm >> visible=true").first();
    await expect(term).toContainText("Image:", { timeout: 10_000 });
    await expect(term).toContainText(imageName, { timeout: 10_000 });
  });
});
