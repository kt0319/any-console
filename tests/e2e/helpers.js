/**
 * E2E テスト共通ヘルパー。
 *
 * 前提:
 * - any-console が `ANY_CONSOLE_URL`（既定 http://localhost:8888）で起動済み
 * - ANY_CONSOLE_TOKEN env か data/auth.json の token が利用可能
 */
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

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
 * @param {import("@playwright/test").Page} page 認証済みの page（cookie を共有する）
 * @returns {Promise<string[]>}
 */
export async function listSessionIds(page) {
  const res = await page.request.get("/terminal/sessions");
  if (!res.ok()) return [];
  const sessions = await res.json();
  return sessions.map((s) => s.session_id);
}

/**
 * テスト中に増えたターミナルセッションだけを API で削除する。
 * （ローカルの実サーバに対して実行しても、既存セッションには触れない）
 * @param {import("@playwright/test").Page} page
 * @param {string[]} beforeIds テスト開始時点のセッション ID 一覧
 */
export async function cleanupNewSessions(page, beforeIds) {
  const afterIds = await listSessionIds(page);
  for (const id of afterIds.filter((id) => !beforeIds.includes(id))) {
    await page.request.delete(`/terminal/sessions/${id}`).catch(() => {});
  }
}

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
