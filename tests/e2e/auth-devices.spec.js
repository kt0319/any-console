/**
 * Auth ビューのデバイス Revoke・API トークン作成/失効と確認ダイアログの E2E。
 * ユニーク名で自分が作った分だけを操作し、afterEach で API からも後始末する。
 */
import { test, expect, BASE_URL, loadToken, login, bearerHeaders, openSettingsModal, openSettingsView, TOKEN_REQUIRED_MSG } from "./helpers.js";

test.describe("auth devices and api tokens", () => {
  /** @type {string} このテストが登録したデバイスの ID（後始末用） */
  let deviceId = "";
  /** @type {string} このテストが作った API トークンのユニーク名（後始末用） */
  let tokenName = "";

  test.beforeEach(async ({ page, context }) => {
    deviceId = "";
    tokenName = "";
    const token = loadToken();
    test.skip(!token, TOKEN_REQUIRED_MSG);
    await login(page, context, token);
    await openSettingsModal(page);
    await openSettingsView(page, "Auth");
    await expect(page.locator(".modal-title")).toHaveText("Auth", { timeout: 10_000 });
  });

  test.afterEach(async ({ request }) => {
    const token = loadToken();
    if (!token) return;
    // UI 操作が失敗してもテスト作成分を必ず片付ける（404 = 既に削除済みは成功扱い）
    if (deviceId) {
      await request
        .delete(`${BASE_URL}/devices/${encodeURIComponent(deviceId)}`, { headers: bearerHeaders(token) })
        .catch(() => {});
    }
    if (tokenName) {
      const res = await request.get(`${BASE_URL}/api-tokens`, { headers: bearerHeaders(token) }).catch(() => null);
      if (res?.ok()) {
        const leftovers = (await res.json()).filter((t) => t.name === tokenName);
        for (const t of leftovers) {
          await request
            .delete(`${BASE_URL}/api-tokens/${encodeURIComponent(t.id)}`, { headers: bearerHeaders(token) })
            .catch(() => {});
        }
      }
    }
  });

  test("別デバイスを確認ダイアログ付きで Revoke できる", async ({ page, request }) => {
    const token = loadToken();
    // UI からの登録はログインフローそのものなので、API で 2 台目を登録する
    const deviceName = `e2e-device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const registerRes = await request.post(`${BASE_URL}/devices/register`, {
      data: { token, name: deviceName },
    });
    expect(registerRes.ok()).toBeTruthy();
    deviceId = (await registerRes.json()).device_id;
    expect(deviceId).toBeTruthy();

    await page.locator(".modal-title-wrap").click();
    await openSettingsView(page, "Auth");
    const row = page.locator(".device-row", { has: page.locator(".device-name", { hasText: deviceName }) });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.locator('[aria-label="Revoke device"]').click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(`Revoke device "${deviceName}"?`);
    await dialog.locator(".dialog-close-btn").click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    await row.locator('[aria-label="Revoke device"]').click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    const listRes = await page.request.get("/devices");
    expect(listRes.ok()).toBeTruthy();
    expect((await listRes.json()).some((d) => d.id === deviceId)).toBeFalsy();
  });

  test("API トークンを作成すると一度だけ表示され、確認ダイアログ付きで Revoke できる", async ({ page }) => {
    tokenName = `e2e-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const createBtn = page.locator("button", { hasText: "Create" });
    await expect(createBtn).toBeDisabled();

    await page.locator('input[placeholder="Token name (e.g. github-actions)"]').fill(tokenName);
    await createBtn.click();
    const createdInput = page.locator('input[aria-label="New API token"]');
    await expect(createdInput).toBeVisible({ timeout: 10_000 });
    expect(await createdInput.inputValue()).toBeTruthy();
    const row = page.locator(".device-row", { has: page.locator(".device-name", { hasText: tokenName }) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator(".device-tag")).toHaveText("dispatch");

    await row.locator('[aria-label="Revoke API token"]').click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(`Revoke API token "${tokenName}"?`);
    await dialog.locator(".dialog-btn-ok").click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    await expect(createdInput).toBeHidden();

    const listRes = await page.request.get("/api-tokens");
    expect(listRes.ok()).toBeTruthy();
    expect((await listRes.json()).some((t) => t.name === tokenName)).toBeFalsy();
  });
});
