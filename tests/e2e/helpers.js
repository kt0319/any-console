/** E2E テスト共通ヘルパー。外部サーバ実行時のみ ANY_CONSOLE_URL / ANY_CONSOLE_TOKEN（または data/auth.json）を自分で用意する。 */
import fs from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

/** 各 spec は "@playwright/test" ではなくこれを import する。login() が作る Trusted Device を終了時に自動失効させる。 */
export const test = base.extend({
  _revokeDeviceAfterTest: [
    async ({ context, page }, use) => {
      await use();
      let cookies;
      try {
        cookies = await context.cookies();
      } catch {
        return;
      }
      const deviceId = cookies.find((c) => c.name === "any_console_device")?.value;
      if (!deviceId) return;
      // 失効失敗を握りつぶすとデバイスが残り続けるため、404 以外で成功しなければ teardown を失敗させる
      let lastError = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const res = await page.request.delete(`/devices/${encodeURIComponent(deviceId)}`);
          if (res.ok() || res.status() === 404) return;
          lastError = `status=${res.status()}`;
        } catch (e) {
          lastError = e.message || String(e);
        }
      }
      throw new Error(`テスト用デバイスの失効に失敗しました（${lastError}）`);
    },
    { auto: true },
  ],
});
export { expect };

export const TOKEN_REQUIRED_MSG = "ANY_CONSOLE_TOKEN または data/auth.json が必要";

export function loadToken() {
  if (process.env.ANY_CONSOLE_TOKEN) return process.env.ANY_CONSOLE_TOKEN;
  try {
    const raw = fs.readFileSync(path.resolve("data/auth.json"), "utf8");
    return JSON.parse(raw).token || "";
  } catch {
    return "";
  }
}

/** 失敗を空配列にすると cleanupNewSessions が既存セッションを削除しかねないため、失敗時は例外にする。 */
export async function listSessionIds(page) {
  const res = await page.request.get("/terminal/sessions");
  if (!res.ok()) {
    throw new Error(`GET /terminal/sessions に失敗しました（status=${res.status()}）`);
  }
  const sessions = await res.json();
  return sessions.map((s) => s.session_id);
}

/** テスト中に増えたセッションだけを削除する。beforeIds が null なら作成分を判定できないため何も消さない。 */
export async function cleanupNewSessions(page, beforeIds) {
  if (!beforeIds) return;
  let afterIds;
  try {
    afterIds = await listSessionIds(page);
  } catch {
    // 誤削除より消し漏れを優先する
    return;
  }
  for (const id of afterIds.filter((id) => !beforeIds.includes(id))) {
    await page.request.delete(`/terminal/sessions/${id}`).catch(() => {});
  }
}

/** tap: true はモバイル用。空画面メニューがあればタップ、なければ ⌘⇧T で開く。 */
export async function openNewTerminal(page, { tap = false } = {}) {
  const tabs = page.locator(".tab-btn");
  const countBefore = await tabs.count();
  const menuItem = page.locator(".screen-empty-menu-item", { hasText: "New Terminal" });
  if (tap && (await menuItem.count())) {
    await menuItem.tap();
  } else {
    await page.keyboard.press("Meta+Shift+KeyT");
  }
  await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });
  const term = page.locator(".xterm >> visible=true").first();
  await expect(term).toBeVisible({ timeout: 10_000 });
  return term;
}

/** モーダルのタイトルクリックでルートビュー（Sessions）まで遡る。 */
export async function popToNavRoot(page) {
  while (await page.locator(".modal-title-wrap.is-clickable").count()) {
    await page.locator(".modal-title-wrap").click();
  }
}

/**
 * ログインし、テスト中に増えたセッションだけを afterEach で消す。describe 内で1回呼ぶ。
 * セッションは tmux でサーバ側に残り次回以降も resume されるため、増えた分は必ず消す。
 * onBeforeEach は login 前に呼ぶ spec 固有の前処理。idsBefore は beforeEach 完了まで null。
 */
export function useLoginWithSessionCleanup(testRef, opts = {}) {
  const state = { /** @type {string[] | null} */ idsBefore: null };
  testRef.beforeEach(async ({ page, context }) => {
    state.idsBefore = null;
    const token = loadToken();
    testRef.skip(!token, TOKEN_REQUIRED_MSG);
    if (opts.onBeforeEach) await opts.onBeforeEach();
    await login(page, context, token);
    state.idsBefore = await listSessionIds(page);
  });
  testRef.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, state.idsBefore);
  });
  return state;
}

// 使い捨てサーバモードでは playwright.config.js が env を設定済み。フォールバックは開発機の既定値。
export const BASE_URL = process.env.ANY_CONSOLE_URL || "http://localhost:8888";


export function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

/** 200 と 400 / 404（既に存在しない）は成功扱い。失敗はリトライ後に例外にする（握りつぶすと削除済みパスを指す登録が残る）。 */
export async function deleteWorkspaceViaApi(request, token, name) {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const res = await request.delete(`${BASE_URL}/workspaces/${encodeURIComponent(name)}`, {
        headers: bearerHeaders(token),
      });
      if (res.ok() || res.status() === 400 || res.status() === 404) return;
      lastError = `status=${res.status()}`;
    } catch (e) {
      lastError = e.message || String(e);
    }
  }
  throw new Error(`テスト用ワークスペース "${name}" の削除に失敗しました（${lastError}）`);
}

/** 設定モーダルを ⌘⇧. で開く。セッションの有無（空画面 / タブ表示）に依らず使える。 */
export async function openSettingsModal(page) {
  await page.keyboard.press("Meta+Shift+Period");
  await expect(page.locator(".terminal-settings-modal")).toBeVisible({ timeout: 5000 });
}


export async function openSettingsView(page, label) {
  await page.locator(".settings-menu-item", { hasText: label }).first().click();
}

/** タブバーの「+」（Open session）から Workspaces を開く。押すたびに SessionOpenHome ルートへリセットされる。 */
export async function openWorkspaces(page) {
  await page.locator('[aria-label="Open session"]').click();
  await expect(page.locator(".session-open-modal")).toBeVisible({ timeout: 5000 });
}


export async function openAddWorkspace(page) {
  await openWorkspaces(page);
  await page.locator('[data-tooltip="Add workspace"]').click();
}

/** 既存セッションがあると resume されてタブが開くため、Get Started メニューかタブのどちらかの表示をブート完了とみなす。 */
export async function login(page, context, token) {
  await context.clearCookies();
  await page.goto("/");
  await page.locator('input[placeholder="Token"]').fill(token);
  await page.locator("button[type=submit]").click();
  await expect(page.locator(".login-screen")).toBeHidden({ timeout: 10_000 });
  const bootDone = page
    .locator(".screen-empty-menu-item")
    .first()
    .or(page.locator(".tab-btn").first());
  await expect(bootDone.first()).toBeVisible({ timeout: 10_000 });
  // メニュー表示後も block-layer が残る間はタップ・クリックが遮られる
  await expect(page.locator(".block-layer")).toBeHidden({ timeout: 20_000 });
  // ショートカット受付用のフォーカス。座標なしの click は body 中心を叩きモバイルではメニュー項目に命中するため、左上隅を叩く。
  await page.locator("body").click({ position: { x: 0, y: 0 } });
}
