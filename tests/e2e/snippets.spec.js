/**
 * スニペット設定の E2E スモーク。
 * Settings → Snippets での追加・一覧表示・削除を確認する。
 *
 * スニペットはサーバ側（/snippets）に永続化されるため、
 * テスト前の状態を保存しておき afterEach で必ず復元する（既存スニペットを汚さない）。
 */
import { test, expect } from "@playwright/test";
import { BASE_URL, loadToken, login, bearerHeaders, openSettingsModal, openSettingsView } from "./helpers.js";

const SNIPPET_CMD = "echo e2e-snippet-test";

test.describe("snippets", () => {
  /** @type {unknown[]} テスト開始時点のスニペット一覧（後始末で復元する） */
  let snippetsBefore = [];
  /** スナップショット取得に成功したときだけ復元する（失敗時に [] を書き戻すと既存スニペットを消してしまう） */
  let snapshotOk = false;

  test.beforeEach(async ({ page, context, request }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    snapshotOk = false;
    const res = await request.get(`${BASE_URL}/snippets`, { headers: bearerHeaders(token) });
    expect(res.ok(), "スニペットの事前スナップショット取得に失敗（復元不能になるため中断）").toBeTruthy();
    snippetsBefore = (await res.json()).snippets || [];
    snapshotOk = true;
    await login(page, context, token);
  });

  test.afterEach(async ({ request }) => {
    const token = loadToken();
    if (!token || !snapshotOk) return;
    await request.put(`${BASE_URL}/snippets`, { headers: bearerHeaders(token), data: { snippets: snippetsBefore } });
  });

  test("スニペットを追加して一覧に表示され、削除できる", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsView(page, "Snippets");
    await expect(page.locator(".modal-title")).toHaveText("Snippets", { timeout: 10_000 });

    const countBefore = await page.locator(".snippet-row").count();

    // 追加 → 一覧の先頭（新しい順表示）に出る
    await page.locator(".snippet-input").fill(SNIPPET_CMD);
    await page.locator(".snippet-add-btn").click();
    const row = page.locator(".snippet-row", { hasText: SNIPPET_CMD });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".snippet-row")).toHaveCount(countBefore + 1);
    await expect(page.locator(".snippet-input")).toHaveValue("");

    // 削除 → 一覧から消える
    await row.locator('.snippet-delete[aria-label="Delete snippet"]').click();
    await expect(page.locator(".snippet-row", { hasText: SNIPPET_CMD })).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(".snippet-row")).toHaveCount(countBefore);
  });

  test("空のままでは追加ボタンが無効", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsView(page, "Snippets");
    await expect(page.locator(".snippet-add-btn")).toBeDisabled();
  });
});
