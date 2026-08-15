/**
 * 素のターミナルの cwd をワークスペースとして登録した後、前面で実行した
 * コマンドがジョブ定義と一致した際に自動タグ付け（session_job_bound）される
 * フローの E2E。
 *
 * トースト（Job detected）が出ること、タブアイコンが即座にジョブアイコンへ
 * 切り替わること、そして通常どおりワークスペースからジョブを起動した場合と
 * 同じアイコンになる（= ワークスペースアイコン未設定時にjobアイコンへ誤って
 * フォールバックしていたバグの回帰確認）ことを検証する。
 *
 * ジョブの前面検出は agent_watch のポーリング（2秒間隔）に依存するため、
 * 他のE2Eスペックより待ち時間を長めに取る。
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

    // 1. 素のターミナルを開き、テストディレクトリへcdする
    const term = await openNewTerminal(page);
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type(`cd ${wsDir}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // 2. Files pillの並びに出る「Add / Open」からワークスペース登録する
    //    （bare-terminal-actions.ts の resolveRegisterCurrentDirAction が
    //    cwdから未登録ディレクトリと判定しAdd Workspace画面を開く）
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

    // 3. アイコン付きジョブを定義する（UI経由の作成はworkspace-panes.spec.jsで
    //    別途確認済みのため、ここではAPIで最小限に済ませ自動検知フローに集中する）
    const jobRes = await request.post(`${BASE_URL}/workspaces/${wsName}/jobs`, {
      headers: bearerHeaders(token),
      data: { label: jobLabel, command: jobCommand, icon: jobIcon, icon_color: jobIconColor, confirm: false },
    });
    expect(jobRes.ok()).toBeTruthy();

    // 4. 同じターミナルでジョブコマンドをそのまま前面実行し、自動タグ付けを待つ。
    //    シェルのプロンプト側がターミナル機能（色・DA等）を問い合わせ、xterm.jsが
    //    それに自動応答するタイミングと最初の入力が重なると、応答シーケンスの
    //    処理中にシェルのZLEが直後の1文字を読み飛ばすことがある（実機でも再現した
    //    別バグ）。ダミーの1文字を打って即削除し、その応答が落ち着いてから
    //    本命のコマンドを打つことでこの競合を避ける。
    await term.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type(" ");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
    await page.keyboard.type(jobCommand);
    await page.keyboard.press("Enter");

    // トースト（Job detected）が出る
    await expect(page.locator(".toast", { hasText: `Job detected: ${jobLabel}` })).toBeVisible({ timeout: 20_000 });

    // 5. タブのアイコンが即座にジョブアイコンへ切り替わる（session_job_boundのライブ反映）
    const autoTab = page.locator(".tab-btn.active");
    await expect(autoTab.locator(".mdi-rocket-launch")).toBeVisible({ timeout: 5000 });

    // 6. 通常どおりワークスペースからジョブを起動した場合と同じアイコンになることを確認する
    await openWorkspaces(page);
    const row = page.locator(".picker-ws-group", { has: page.locator(".picker-ws-header-label", { hasText: wsName }) });
    await row.locator(".picker-ws-header-label").click();
    const jobItem = row.locator(".job-item-row", { has: page.locator(".job-item-label", { hasText: jobLabel }) });
    await expect(jobItem).toBeVisible({ timeout: 10_000 });

    const tabs = page.locator(".tab-btn");
    const tabCountBefore = await tabs.count();
    await jobItem.locator(".job-item").click();
    await expect(tabs).toHaveCount(tabCountBefore + 1, { timeout: 10_000 });

    const launchedTab = page.locator(".tab-btn.active");
    await expect(launchedTab.locator(".mdi-rocket-launch")).toBeVisible({ timeout: 5000 });

    // 自動検知タブ・通常起動タブどちらもjobアイコンの色まで一致する
    const autoStyle = await autoTab.locator(".mdi-rocket-launch").getAttribute("style");
    const launchedStyle = await launchedTab.locator(".mdi-rocket-launch").getAttribute("style");
    expect(autoStyle).toBe(launchedStyle);
  });
});
