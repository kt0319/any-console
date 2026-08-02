/**
 * ターミナル分割（split pane）の E2E スモーク。
 * タブをドロップゾーンへドラッグして horizontal split へ遷移できること、
 * および Tabs & Sessions（TabConfig.vue）の SplitModeSelector で
 * vertical split へ軸切替えできることを確認する
 * （stores/layout.js の splitWithDrop / setSplitLayout）。
 * 以前はワークスペースピルのドラッグでも分割できたが、ピルのドラッグは
 * ピル群の画面位置（top/bottom）切替えに用途を変更したため、分割の入口は
 * タブ（TabItem.vue、ネイティブHTML5 DnD）のみになった。また split mode
 * に入るとタブバー自体が非表示になる（TabBar.vue）ため、分割後の軸切替えは
 * ドラッグではなく SplitModeSelector のボタンで行う。
 */
import { test, expect, loadToken, login, listSessionIds, cleanupNewSessions, openSettingsModal, openSettingsView } from "./helpers.js";

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
  /** @type {string[] | null} テスト開始時点のセッション ID（後始末で増分だけ消す。null = 未取得） */
  let sessionIdsBefore = null;

  test.beforeEach(async ({ page, context }) => {
    sessionIdsBefore = null;
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  test("タブドラッグで horizontal split に入り、SplitModeSelectorで vertical split へ軸切替えできる", async ({ page }) => {
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

    // split mode に入るとタブバー（.tab-btn）は非表示になるため、軸切替えは
    // Tabs & Sessions（TabConfig.vue）の SplitModeSelector ボタンで行う。
    await openSettingsModal(page);
    await openSettingsView(page, "Tabs & Sessions");
    await page.locator('.modal-overlay .split-tab-mode-option[aria-label="Vertical split"] >> visible=true').click();
    await page.locator(".modal-overlay .modal-close-btn").click();

    await expect(page.locator(".output-container.split-vertical")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("pill reposition drag", () => {
  /** @type {string[] | null} テスト開始時点のセッション ID（後始末で増分だけ消す。null = 未取得） */
  let sessionIdsBefore = null;

  test.beforeEach(async ({ page, context }) => {
    sessionIdsBefore = null;
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
    // 位置設定は他テストへ影響しないようtopへ戻しておく
    const res = await page.request.get("/settings/info-pills");
    const body = await res.json();
    await page.request.put("/settings/info-pills", { data: { ...body, position: "top" } });
  });

  test("ワークスペースピルを下へドラッグすると、ピル群が画面下部（bottom）へ切り替わる", async ({ page }) => {
    await page.keyboard.press("Meta+Shift+KeyT");
    await expect(page.locator(".xterm >> visible=true").first()).toBeVisible({ timeout: 10_000 });

    const pillGroup = page.locator(".pill-group >> visible=true").first();
    await expect(pillGroup).not.toHaveClass(/pill-group-bottom/);

    const pill = page.locator(".terminal-info-pill >> visible=true").first();
    const pillBox = await pill.boundingBox();
    const viewport = page.viewportSize();

    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await page.mouse.down();
    // DRAG_THRESHOLD(15px)を超えてドラッグ開始 → 画面下半分まで動かして離す
    await page.mouse.move(pillBox.x + pillBox.width / 2, viewport.height - 40, { steps: 10 });
    await page.mouse.up();

    await expect(pillGroup).toHaveClass(/pill-group-bottom/);
  });
});
