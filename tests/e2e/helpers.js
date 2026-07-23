/**
 * E2E テスト共通ヘルパー。
 *
 * 前提:
 * - 既定では playwright.config.js が使い捨てサーバを自動起動し、
 *   ANY_CONSOLE_URL / ANY_CONSOLE_TOKEN を env に設定する
 * - 外部サーバに対して実行する場合のみ ANY_CONSOLE_URL を自分で指定し、
 *   ANY_CONSOLE_TOKEN env か data/auth.json の token を用意する
 */
import fs from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

/**
 * 全 E2E 共通の test（各 spec は "@playwright/test" ではなくこれを import する）。
 * login() はテストごとに Trusted Device を新規登録するため、テスト終了後に
 * そのテストのデバイスを自動失効させる auto fixture を仕込む
 * （ローカルの実サーバに対して実行しても devices.json に孤児デバイスが溜まらない）。
 */
export const test = base.extend({
  _revokeDeviceAfterTest: [
    async ({ context, page }, use) => {
      await use();
      let cookies;
      try {
        cookies = await context.cookies();
      } catch {
        // テスト中断でコンテキストが既に閉じている場合のみ諦める
        return;
      }
      const deviceId = cookies.find((c) => c.name === "any_console_device")?.value;
      if (!deviceId) return;
      // 失効の失敗を握りつぶすとデバイスが残り続けるため、リトライの上で
      // 成功（または既に存在しない = 404）を確認できなければ teardown を失敗させる
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

export function loadToken() {
  if (process.env.ANY_CONSOLE_TOKEN) return process.env.ANY_CONSOLE_TOKEN;
  try {
    const raw = fs.readFileSync(path.resolve("data/auth.json"), "utf8");
    return JSON.parse(raw).token || "";
  } catch {
    return "";
  }
}

/**
 * 現在のターミナルセッション ID 一覧を API から取得する。
 * 取得失敗を空配列にすると「既存セッションが全部テスト作成物」に見えてしまい、
 * cleanupNewSessions が既存セッションを削除しかねないため、失敗時は例外にする。
 * @param {import("@playwright/test").Page} page 認証済みの page（cookie を共有する）
 * @returns {Promise<string[]>}
 */
export async function listSessionIds(page) {
  const res = await page.request.get("/terminal/sessions");
  if (!res.ok()) {
    throw new Error(`GET /terminal/sessions に失敗しました（status=${res.status()}）`);
  }
  const sessions = await res.json();
  return sessions.map((s) => s.session_id);
}

/**
 * テスト中に増えたターミナルセッションだけを API で削除する。
 * （ローカルの実サーバに対して実行しても、既存セッションには触れない）
 * @param {import("@playwright/test").Page} page
 * @param {string[] | null} beforeIds テスト開始時点のセッション ID 一覧。
 *   null（beforeEach がスナップショット取得前に失敗した等）の場合は
 *   「テストが作った分」を判定できないため何も消さない。
 */
export async function cleanupNewSessions(page, beforeIds) {
  if (!beforeIds) return;
  let afterIds;
  try {
    afterIds = await listSessionIds(page);
  } catch {
    // 現在一覧を取得できない場合も、誤削除しないよう消し漏れ側に倒す
    return;
  }
  for (const id of afterIds.filter((id) => !beforeIds.includes(id))) {
    await page.request.delete(`/terminal/sessions/${id}`).catch(() => {});
  }
}

// 使い捨てサーバモードでは playwright.config.js が env を設定済み。
// フォールバックは「外部サーバモードで URL 指定を忘れた」場合の開発機既定値。
export const BASE_URL = process.env.ANY_CONSOLE_URL || "http://localhost:8888";

/**
 * API 直叩き用の Bearer 認証ヘッダを作る（テストの setup / cleanup 用）。
 * @param {string} token
 */
export function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * テストが登録したワークスペースを API で確実に削除する（後始末用）。
 * 200（削除成功）と 400 / 404（既に存在しない）は成功扱い。
 * それ以外はリトライし、失敗が残る場合は例外にして後始末の失敗を顕在化させる
 * （握りつぶすと、実サーバに「削除済みパスを指す登録」が残るため）。
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {string} token
 * @param {string} name ワークスペース名
 */
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

/**
 * 設定モーダルをグローバルショートカット（⌘⇧.）で開く。
 * 既存セッションの有無（空画面 / タブ表示）に依らず使える。
 * @param {import("@playwright/test").Page} page
 */
export async function openSettingsModal(page) {
  await page.keyboard.press("Meta+Shift+Period");
  await expect(page.locator(".modal-overlay")).toBeVisible({ timeout: 5000 });
}

/**
 * 設定モーダル内で指定ラベルのメニュー項目を開く。
 * @param {import("@playwright/test").Page} page
 * @param {string} label 例: "Add Workspace"
 */
export async function openSettingsView(page, label) {
  await page.locator(".settings-menu-item", { hasText: label }).first().click();
}

/**
 * Settings → Workspaces → 「+」ボタンから Add Workspace 画面を開く。
 * @param {import("@playwright/test").Page} page
 */
export async function openAddWorkspace(page) {
  await openSettingsView(page, "Workspaces");
  await page.locator('[data-tooltip="Add workspace"]').click();
}

/**
 * ログイン画面からトークン認証し、ブート完了まで待つ。
 * サーバに既存セッションがあると resume されてタブが開くため、
 * 「Get Started メニュー」か「タブ」のどちらかの表示をブート完了の合図にする。
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").BrowserContext} context
 * @param {string} token
 */
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
  // メニュー表示後もブート用の block-layer が残っている間はタップ・クリックが
  // 遮られるため、消えるまで待つ（サーバ起動直後の初回ブートで遅くなることがある）。
  await expect(page.locator(".block-layer")).toBeHidden({ timeout: 20_000 });
  // キーボードショートカットが確実に受け付けられるようページにフォーカスを当てる。
  // 座標指定なしの click は body 中心を叩くため、モバイルビューポートでは画面中央の
  // Get Started メニュー項目に命中して誤操作してしまう。何も無い左上隅を叩く。
  await page.locator("body").click({ position: { x: 0, y: 0 } });
}
