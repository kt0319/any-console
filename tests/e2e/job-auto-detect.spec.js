/**
 * 素のターミナルで前面実行したコマンドがジョブ定義と一致した際の自動タグ付け（session_job_bound）を検証する。
 * ジョブの前面検出は agent_watch のポーリング（2秒間隔）に依存するため、待ち時間を長めに取る。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  test, expect, BASE_URL, loadToken, login, bearerHeaders,
  deleteWorkspaceViaApi, openNewTerminal, listSessionIds, cleanupNewSessions,
  openWorkspaces, TOKEN_REQUIRED_MSG,
} from "./helpers.js";

test.describe.configure({ mode: "serial" });

test.describe("job auto-detect from bare terminal", () => {
  let wsDir = "";
  let wsName = "";
  const jobLabel = "E2E Auto Job";
  const jobCommand = "sleep 987654321";
  const jobIcon = "mdi-rocket-launch";
  const jobIconColor = "#e53935";
  let beforeIds = null;

  test.beforeAll(() => {
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-autojob-"));
    wsName = path.basename(wsDir);
  });

  test.afterAll(async ({ request }) => {
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
    beforeIds = await listSessionIds(page).catch(() => null);
  });

  test.afterEach(async ({ page }) => {
    // sleepを前面実行したまま残っていてもセッション削除で一緒に刈り取られる。
    await cleanupNewSessions(page, beforeIds);
  });

  test("ワークスペース追加 → 前面コマンド一致でジョブ自動検知 → 通常起動と同じアイコンになる", async ({ page, request }) => {
    const token = loadToken();

    const term = await openNewTerminal(page);
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type(`cd ${wsDir}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    await page.locator(".pill-add-btn").click();
    await expect(page.locator(".modal-title")).toHaveText("Add Workspace", { timeout: 5000 });
    // クリックが希に取りこぼされることがあるため、反映が無ければ再クリックする。
    await page.locator(".ws-add-submit-btn").click();
    try {
      await expect(page.locator(".modal-title")).toHaveText("Open Session", { timeout: 5000 });
    } catch {
      await expect(page.locator(".form-message.error")).toHaveCount(0);
      await page.locator(".ws-add-submit-btn").click();
      await expect(page.locator(".modal-title")).toHaveText("Open Session", { timeout: 15_000 });
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".session-open-modal")).toHaveCount(0, { timeout: 5000 });

    // UI経由の作成は workspace-panes.spec.js で確認済みのため、ここではAPIで済ませる
    const jobRes = await request.post(`${BASE_URL}/workspaces/${wsName}/jobs`, {
      headers: bearerHeaders(token),
      data: { label: jobLabel, command: jobCommand, icon: jobIcon, icon_color: jobIconColor, confirm: false },
    });
    expect(jobRes.ok()).toBeTruthy();

    // シェルへの問い合わせに xterm.js が自動応答するタイミングと最初の入力が重なると、ZLE が直後の1文字を
    // 読み飛ばすことがある。ダミー1文字を打って即削除し、応答が落ち着いてから本命を打つ。
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type(" ");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
    await page.keyboard.type(jobCommand);
    await page.keyboard.press("Enter");

    await expect(page.locator(".pill-peek-wide", { hasText: jobLabel }).first()).toBeVisible({ timeout: 20_000 });

    const autoTab = page.locator(".tab-btn.active");
    await expect(autoTab.locator(".mdi-rocket-launch")).toBeVisible({ timeout: 5000 });

    await openWorkspaces(page);
    const row = page.locator(".ws-list-item", { has: page.locator(".ws-list-header-label", { hasText: wsName }) });
    await row.locator('[aria-label="Select job"]').click();
    const jobItem = page.locator(".ws-job-dialog .job-item-row", { has: page.locator(".job-item-label", { hasText: jobLabel }) });
    await expect(jobItem).toBeVisible({ timeout: 10_000 });

    const tabs = page.locator(".tab-btn");
    const tabCountBefore = await tabs.count();
    await jobItem.locator(".job-item").click();
    await expect(tabs).toHaveCount(tabCountBefore + 1, { timeout: 10_000 });

    const launchedTab = page.locator(".tab-btn.active");
    await expect(launchedTab.locator(".mdi-rocket-launch")).toBeVisible({ timeout: 5000 });

    const autoStyle = await autoTab.locator(".mdi-rocket-launch").getAttribute("style");
    const launchedStyle = await launchedTab.locator(".mdi-rocket-launch").getAttribute("style");
    expect(autoStyle).toBe(launchedStyle);
  });
});
