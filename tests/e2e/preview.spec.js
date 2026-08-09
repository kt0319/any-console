/**
 * Dev Server（Port Preview）の E2E スモーク。
 * ワークスペースの cwd でダミーの dev server を起動し、Server ピルに検出される
 * ことと、確認ダイアログ（Open / Copy）の Open から proxy 経由で実際に到達
 * できることを確認する（Dev Server 一覧ページは廃止済みのため、Server ピルが
 * 唯一の UI 導線）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test, expect, BASE_URL, loadToken, login, bearerHeaders, deleteWorkspaceViaApi, openWorkspaces, listSessionIds, cleanupNewSessions } from "./helpers.js";

// PROXY_MIN_TARGET(1024) 〜 PROXY_MAX_TARGET(9999) の範囲に収める（server/src/preview.rs）。
// 8888(any-console本体) と衝突しない値を選ぶ。proxy は +PROXY_OFFSET(20000) に立つ。
const DUMMY_PORT = 8765;
const PROXY_PORT = DUMMY_PORT + 20000;
const DUMMY_BODY = "e2e-dummy-dev-server";

test.describe("port preview", () => {
  let wsDir = "";
  let wsName = "";
  /** @type {import("node:child_process").ChildProcess | null} */
  let dummyProc = null;

  test.beforeAll(async ({ request }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");

    // ポート → ワークスペースの紐付けはサーバ側がプロセスの cwd で行う
    // （server/src/preview.rs の match_workspace）ため、一時ディレクトリを
    // ワークスペース登録し、その cwd を起点にダミーサーバを起動する。
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-preview-"));
    wsName = path.basename(wsDir);
    const res = await request.post(`${BASE_URL}/workspaces`, {
      headers: bearerHeaders(token),
      data: { path: wsDir },
    });
    expect(res.ok()).toBeTruthy();

    // テストランナー自身の cwd（リポジトリ）でリッスンすると紐付け先が変わって
    // しまうため、子プロセスとして cwd=wsDir で起動する。
    const serverScript = `
      const http = require("node:http");
      http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(${JSON.stringify(DUMMY_BODY)});
      }).listen(${DUMMY_PORT}, "127.0.0.1", () => console.log("ready"));
    `;
    dummyProc = spawn(process.execPath, ["-e", serverScript], { cwd: wsDir, stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((resolve, reject) => {
      const onExit = (code) => reject(new Error(`ダミー dev server が起動前に終了しました (code=${code})`));
      dummyProc.once("exit", onExit);
      dummyProc.stdout.once("data", () => {
        dummyProc.off("exit", onExit);
        resolve(undefined);
      });
    });
  });

  test.afterAll(async ({ request }) => {
    if (dummyProc && dummyProc.exitCode === null) dummyProc.kill("SIGKILL");
    const token = loadToken();
    if (token && wsName) {
      await deleteWorkspaceViaApi(request, token, wsName);
    }
    if (wsDir) fs.rmSync(wsDir, { recursive: true, force: true });
  });

  /** @type {string[] | null} テスト開始時点のセッション ID（後始末で増分だけ消す。null = 未取得） */
  let sessionIdsBefore = null;

  test.beforeEach(async ({ page, context }) => {
    sessionIdsBefore = null;
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  test("Server ピルに検出され、確認ダイアログの Open で proxy 経由に到達できる", async ({ page, context }) => {
    // Server ピルはワークスペース紐付きタブにのみ出るため、登録した
    // ワークスペースの Terminal ジョブからセッションを開く。
    await openWorkspaces(page);
    const row = page.locator(".picker-ws-group", { has: page.locator(".picker-ws-header-label", { hasText: wsName }) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.locator(".picker-ws-header-label").click();
    await row.locator(".job-item-label", { hasText: "Terminal" }).click();
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });

    // サイドバーのセッション行にも同じ .pill-server-btn が出るため、サイドバーを
    // 閉じて TerminalPane のピル行だけを対象にする（PCはサイドバー展開中
    // ハンバーガー自体を隠すため、タイトル行の閉じるボタンを使う）。
    await page.locator(".modal-close-btn").click();
    await expect(page.locator(".settings-panel")).toBeHidden({ timeout: 5000 });

    // GET /preview/ports はアクセス時に同期でスキャンを起こす（server/src/preview.rs）。
    // TerminalPane のポーリング間隔（DEV_SERVER_POLL_INTERVAL_MS=10s）を最大
    // 2周ぶん待てば、起動直後のスキャン空振りがあっても反映される。
    const pill = page.locator(".pill-server-btn").first();
    await expect(pill).toBeVisible({ timeout: 30_000 });

    // 一覧反映は同期だが、実際の TCP proxy listener は HTTP プローブ完了後に
    // 非同期タスクとして起動される（server/src/preview.rs の reconcile_proxies）ため、
    // ピルが見えた直後はまだ bind されていないことがある。起動を少し待つ。
    await page.waitForTimeout(2000);

    await pill.click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator(".confirm-message")).toContainText(`:${PROXY_PORT}`);
    // Copy（URLコピーのみで開かない操作）が Open と並んで選べること
    await expect(dialog.locator(".confirm-btn-extra", { hasText: "Copy" })).toBeVisible();

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      dialog.locator(".dialog-btn-ok").click(),
    ]);
    await popup.waitForLoadState();
    expect(popup.url()).toContain(`:${PROXY_PORT}`);
    await expect(popup.locator("body")).toContainText(DUMMY_BODY, { timeout: 10_000 });
    await popup.close();
  });
});
