import { useLayoutStore } from "../stores/layout.ts";

// セッション一覧・Open Session・Settings・WorkspaceDetail の4オーバーレイを排他制御するレジストリ。
// 各 composable がマウント時に registerOverlay(key, closeFn) で閉じ方を登録し、開く直前に closeOthersOn(key) を呼ぶ。
// モバイルは4つ全て排他。PC は sessionList（サイドバー）だけ排他対象外で、他の3つと同時表示できる。

export type OverlayKey = "sessionList" | "sessionOpen" | "settings" | "workspaceDetail";

const closers = new Map<OverlayKey, () => void>();

function registerOverlay(key: OverlayKey, closeFn: () => void) {
  closers.set(key, closeFn);
}

function closeOthersOn(key: OverlayKey) {
  const layoutStore = useLayoutStore();
  const mobile = layoutStore.isTabBarAtBottom;
  for (const [k, close] of closers) {
    if (k === key) continue;
    if (!mobile && (k === "sessionList" || key === "sessionList")) continue;
    close();
  }
}

export function useExclusiveOverlay() {
  return { registerOverlay, closeOthersOn };
}
