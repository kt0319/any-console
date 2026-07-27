/**
 * スニペット設定の E2E スモーク。
 * Settings → Send Snippet での追加・一覧表示・削除を確認する。
 *
 * スニペットはサーバ側（/snippets）に永続化されるため、afterEach で
 * このテストが作った分（snippetCmd）だけを現在の一覧から取り除く。
 * スナップショットの全書き戻しは、テスト実行中に行われた無関係な編集まで
 * 巻き戻してしまうため行わない（既存スニペットを汚さない）。
 */
import { test, expect, BASE_URL, loadToken, login, bearerHeaders, openSettingsModal, openSettingsView } from "./helpers.js";

test.describe("snippets", () => {
  /**
   * テストごとにユニークなコマンド。固定文字列だと、ユーザーが偶然同じコマンドの
   * スニペットを持っていた場合に後始末で消してしまうため、毎回生成する。
   * @type {string}
   */
  let snippetCmd = "";

  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    snippetCmd = `echo e2e-snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await login(page, context, token);
  });

  test.afterEach(async ({ request }) => {
    const token = loadToken();
    if (!token) return;
    // このテストのスニペットだけを差分で取り除く。後始末の失敗を握りつぶすと
    // テスト用スニペットが残るため、リトライの上で成功しなければ teardown を失敗させる
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

  test("スニペットを追加して一覧に表示され、削除できる", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsView(page, "Send Snippet");
    await expect(page.locator(".modal-title")).toHaveText("Send Snippet", { timeout: 10_000 });

    const countBefore = await page.locator(".snippet-row").count();

    // 追加 → 一覧の先頭（新しい順表示）に出る
    await page.locator(".snippet-input").fill(snippetCmd);
    await page.locator(".snippet-add-btn").click();
    const row = page.locator(".snippet-row", { hasText: snippetCmd });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".snippet-row")).toHaveCount(countBefore + 1);
    await expect(page.locator(".snippet-input")).toHaveValue("");

    // 削除 → 一覧から消える
    await row.locator('.snippet-delete[aria-label="Delete snippet"]').click();
    await expect(page.locator(".snippet-row", { hasText: snippetCmd })).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(".snippet-row")).toHaveCount(countBefore);
  });

  test("空のままでは追加ボタンが無効", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsView(page, "Send Snippet");
    await expect(page.locator(".snippet-add-btn")).toBeDisabled();
  });
});
