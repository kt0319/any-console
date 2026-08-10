/**
 * ターミナル分割（split pane）の E2E スモーク。
 * タブをドロップゾーンへドラッグして horizontal split へ遷移できること
 * を確認する（stores/layout.js の splitWithDrop）。
 * 以前はワークスペースピルのドラッグでも分割やピル群の画面位置（top/bottom）
 * 切替えができたが、いずれも廃止し、位置はデバイス（PC/モバイル）に応じて
 * 自動で決まるようになった。分割の入口はタブ（TabItem.vue、ネイティブHTML5
 * DnD）のみ。split mode 中もタブバー（TabBar.vue）は表示され続ける。
 */
import { test, expect, useLoginWithSessionCleanup } from "./helpers.js";

/**
 * タブをドラッグして指定のドロップゾーンへドロップする。
 * TabItem.vue はネイティブ HTML5 draggable のため、実際のマウス操作で
 * ブラウザ自身のドラッグ機構を発火させる（dragTo() は対象の可視化を
 * 事前に要求するため使えない。ドロップゾーンはドラッグ開始後にしか
 * マウントされない）。
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} tabBtn
 * @param {string} zoneSelector 例: ".drop-left"
 */
async function dragTabToZone(page, tabBtn, zoneSelector) {
  const tabBox = await tabBtn.boundingBox();
  const startX = tabBox.x + tabBox.width / 2;
  const startY = tabBox.y + tabBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // DRAG_THRESHOLD(15px) を超える最初の動きでネイティブドラッグが開始 → ドロップゾーンがマウントされる
  await page.mouse.move(startX + 30, startY + 30, { steps: 5 });

  const zone = page.locator(zoneSelector);
  await expect(zone).toBeVisible({ timeout: 5000 });
  const zoneBox = await zone.boundingBox();
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.describe("terminal split", () => {
  useLoginWithSessionCleanup(test);

  test("タブドラッグで horizontal split に入る", async ({ page }) => {
    const tabs = page.locator(".tab-btn");
    const countBefore = await tabs.count();

    // 分割先に選べるタブが要るため2つ開く
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 1, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(tabs).toHaveCount(countBefore + 2, { timeout: 10_000 });
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });

    const tab = tabs.last();
    await expect(tab).toBeVisible({ timeout: 5000 });

    await dragTabToZone(page, tab, ".drop-left");
    await expect(page.locator(".output-container.split-horizontal")).toBeVisible({ timeout: 5000 });
  });
});
