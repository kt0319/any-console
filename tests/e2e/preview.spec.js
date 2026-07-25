/**
 * Port Preview の E2E スモーク。
 * ダミーの dev server を1個ポートで起動し、Port Preview パネルに検出される
 * ことと、Open ボタンから proxy 経由で実際に到達できることを確認する。
 */
import http from "node:http";
import { test, expect, loadToken, login } from "./helpers.js";

// PROXY_MIN_TARGET(1024) 〜 PROXY_MAX_TARGET(9999) の範囲に収める（api/preview.py）。
// 8888(any-console本体) と衝突しない値を選ぶ。
const DUMMY_PORT = 8765;
const DUMMY_BODY = "e2e-dummy-dev-server";

test.describe("port preview", () => {
  let dummyServer;

  test.beforeAll(async () => {
    dummyServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(DUMMY_BODY);
    });
    await new Promise((resolve, reject) => {
      dummyServer.once("error", reject);
      dummyServer.listen(DUMMY_PORT, "127.0.0.1", resolve);
    });
  });

  test.afterAll(async () => {
    await new Promise((resolve) => dummyServer.close(resolve));
  });

  test("ダミーの dev server が一覧に検出され、Open で proxy 経由に到達できる", async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);

    await page.keyboard.press("Meta+Shift+Period");
    await expect(page.locator(".modal-overlay")).toBeVisible({ timeout: 5000 });
    await page.locator(".settings-menu-item", { hasText: "Port Preview" }).click();
    await expect(page.locator(".modal-title")).toHaveText("Port Preview");

    // GET /preview/ports はアクセス時に同期でスキャンを起こす（api/routers/preview.py）ため、
    // バックグラウンドスキャン間隔を待たずに一覧へ反映される。
    const row = page.locator(".preview-row", { hasText: `:${DUMMY_PORT}` });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 一覧表示は同期だが、実際の TCP proxy listener は HTTP プローブ完了後に
    // 非同期タスクとして起動される（api/preview.py の _reconcile_proxies）ため、
    // 行が見えた直後はまだ bind されていないことがある。起動を少し待つ。
    await page.waitForTimeout(2000);

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      row.locator(".preview-open").click(),
    ]);
    await popup.waitForLoadState();
    expect(popup.url()).toContain(`:${DUMMY_PORT + 20000}`);
    await expect(popup.locator("body")).toContainText(DUMMY_BODY, { timeout: 10_000 });
    await popup.close();

    await page.locator(".tab-settings-btn").click();
    await expect(page.locator(".modal-overlay")).toBeHidden({ timeout: 5000 });
  });
});
