/** ターミナル分割（split pane）E2E: タブをドロップゾーンへドラッグして horizontal split へ遷移できること。 */
import { test, expect, useLoginWithSessionCleanup, openNewTerminal } from "./helpers.js";

/**
 * 実マウス操作でタブをドロップゾーンへドラッグする。ドロップゾーンはドラッグ開始後にマウントされるため dragTo() は使えない。
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

    // 分割先に選べるタブが要るため2つ開く
    await openNewTerminal(page);
    await openNewTerminal(page);

    const tab = tabs.last();
    await expect(tab).toBeVisible({ timeout: 5000 });

    await dragTabToZone(page, tab, ".drop-left");
    await expect(page.locator(".output-container.split-horizontal")).toBeVisible({ timeout: 5000 });
  });
});
