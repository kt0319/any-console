/**
 * スニペットの追加・一覧表示・削除（モバイルの KeyboardBar Snippet タブ経由）。
 * サーバ側に永続化されるため afterEach でこのテストが作った分だけを差分で取り除く（全書き戻しは無関係な編集を巻き戻す）。
 */
import { test, expect, BASE_URL, loadToken, bearerHeaders, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test.describe("snippets", () => {
  // 固定文字列だと偶然同じ既存スニペットを後始末で消すため、毎回生成する
  let snippetCmd = "";

  useLoginWithSessionCleanup(test, {
    onBeforeEach: () => {
      snippetCmd = `echo e2e-snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    },
  });

  test.afterEach(async ({ request }) => {
    const token = loadToken();
    if (!token) return;
    // 後始末の失敗を握りつぶすとスニペットが残るため、リトライしても失敗なら teardown を失敗させる
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
      const res = await request.get(`${BASE_URL}/snippets`, { headers: bearerHeaders(token) });
      if (!res.ok()) {
        lastStatus = res.status();
        continue;
      }
      const current = (await res.json()).snippets || [];
      const kept = current.filter((s) => s.command !== snippetCmd);
      if (kept.length === current.length) return; // テスト用スニペットは残っていない
      const putRes = await request.put(`${BASE_URL}/snippets`, {
        headers: bearerHeaders(token),
        data: { snippets: kept },
      });
      if (putRes.ok()) return;
      lastStatus = putRes.status();
    }
    throw new Error(`テスト用スニペットの後始末に失敗しました（status=${lastStatus}）`);
  });

  async function openSnippetPanel(page) {
    await openNewTerminal(page, { tap: true });
    await expect(page.locator(".keyboard-bar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".quick-key-toggle").first().tap();
    const snippetTab = page.locator('.keyboard-bar-tab[aria-label="Snippet"]');
    await expect(snippetTab).toBeVisible({ timeout: 5000 });
    await snippetTab.tap();
    await expect(page.locator(".snippet-add")).toBeVisible({ timeout: 5000 });
  }

  test("スニペットを追加して一覧に表示され、削除できる", async ({ page }) => {
    await openSnippetPanel(page);

    const countBefore = await page.locator(".snippet-row").count();

    await page.locator(".snippet-input").fill(snippetCmd);
    await page.locator(".snippet-add-btn").tap();
    const row = page.locator(".snippet-row", { hasText: snippetCmd });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".snippet-row")).toHaveCount(countBefore + 1);
    await expect(page.locator(".snippet-input")).toHaveValue("");

    await row.locator('.snippet-delete[aria-label="Delete snippet"]').tap();
    await expect(page.locator(".snippet-row", { hasText: snippetCmd })).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(".snippet-row")).toHaveCount(countBefore);
  });

  test("空のままでは追加ボタンが無効", async ({ page }) => {
    await openSnippetPanel(page);
    await expect(page.locator(".snippet-add-btn")).toBeDisabled();
  });
});
