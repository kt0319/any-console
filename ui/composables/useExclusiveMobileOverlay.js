import { useLayoutStore } from "../stores/layout.js";

// セッション一覧(sessionList)・Open Session(sessionOpen)・Settings(settings)・
// WorkspaceDetail(workspaceDetail)の4オーバーレイを排他制御するための
// レジストリ。各composableがマウント時にregisterOverlay(key, closeFn)で
// 自分の閉じ方を登録し、開く直前にcloseOthersOn(key)を呼ぶことで、他の
// オーバーレイを閉じてから自分を開ける。
//
// モバイル(layoutStore.isPanelBottom)は4つ全てが互いに排他（最新に開いた
// ものだけ表示）。PCはsessionList（サイドバー）だけ排他対象外とし、常に
// 他の3つと同時表示できるようにする（現行のSidebar+WorkspaceDetail同時
// 表示と同じ感覚を維持するため）。sessionOpen/settings/workspaceDetailの
// 3つはPCでも互いに排他。

/** @typedef {"sessionList" | "sessionOpen" | "settings" | "workspaceDetail"} OverlayKey */

/** @type {Map<OverlayKey, () => void>} */
const closers = new Map();

/** @param {OverlayKey} key */
function registerOverlay(key, closeFn) {
  closers.set(key, closeFn);
}

/** @param {OverlayKey} key */
function closeOthersOn(key) {
  const layoutStore = useLayoutStore();
  const mobile = layoutStore.isPanelBottom;
  for (const [k, close] of closers) {
    if (k === key) continue;
    if (!mobile && (k === "sessionList" || key === "sessionList")) continue;
    close();
  }
}

export function useExclusiveMobileOverlay() {
  return { registerOverlay, closeOthersOn };
}
