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
  // キーボードショートカットが確実に受け付けられるようページにフォーカスを当てる。
  // 座標指定なしの click は body 中心を叩くため、モバイルビューポートでは画面中央の
  // Get Started メニュー項目に命中して誤操作してしまう。何も無い左上隅を叩く。
  await page.locator("body").click({ position: { x: 0, y: 0 } });
}
