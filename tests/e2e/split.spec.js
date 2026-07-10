/**
 * ターミナル分割（split pane）の E2E スモーク。
 * ピルをドロップゾーンへドラッグして horizontal split → vertical split へ
 * 遷移できることを確認する（stores/layout.js の splitWithDrop の軸切り替え）。
 */
import { test, expect } from "@playwright/test";
import { loadToken, login, listSessionIds, cleanupNewSessions } from "./helpers.js";

/**
 * ピルを指定のドロップゾーンへドラッグする。
 * usePillDrag.js は独自のマウスイベントベース実装（HTML5 DnD ではない）。
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} pill
 * @param {string} zoneSelector 例: ".drop-left"
 */
async function dragPillToZone(page, pill, zoneSelector) {
  const pillBox = await pill.boundingBox();
  const startX = pillBox.x + pillBox.width / 2;
  const startY = pillBox.y + pillBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // DRAG_THRESHOLD(15px) を超える最初の動きでドラッグ開始 → ドロップゾーンがマウントされる
  await page.mouse.move(startX + 30, startY + 30, { steps: 5 });

  const zone = page.locator(zoneSelector);
  await expect(zone).toBeVisible({ timeout: 5000 });
  const zoneBox = await zone.boundingBox();
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.describe("terminal split", () => {
  /** @type {string[]} テスト開始時点のセッション ID（後始末で増分だけ消す） */
  let sessionIdsBefore = [];

  test.beforeEach(async ({ page, context }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  test("ピルドラッグで horizontal split → vertical split へ遷移できる", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();

    // 分割先に選べるタブが要るため2つ開く
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 2, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });

    // 非split時、非アクティブタブの TerminalPane は v-show で非表示のまま DOM に残る
    // （TerminalBase.vue）。.first() では表示中とは限らないため visible=true で絞る。
    const pill = page.locator(".terminal-info-pill >> visible=true").first();
    await expect(pill).toBeVisible({ timeout: 5000 });

    await dragPillToZone(page, pill, ".drop-left");
    await expect(page.locator(".output-container.split-horizontal")).toBeVisible({ timeout: 5000 });

    await dragPillToZone(page, pill, ".drop-top");
    await expect(page.locator(".output-container.split-vertical")).toBeVisible({ timeout: 5000 });
  });
});
