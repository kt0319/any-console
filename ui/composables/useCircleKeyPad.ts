import { computed, reactive } from "vue";
import { dispatchKeyToTab, dispatchTextToTab } from "../utils/terminal-dispatch.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { getFullBufferText } from "../utils/terminal-buffer-text.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import type { TerminalTab } from "../stores/terminal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useCircleKeyPadConfigStore } from "../stores/circle-keypad-config.ts";
import {
  CIRCLE_KEYPAD_ANGLES,
  SPECIAL_POSITIONS,
  SPECIAL_BUTTON_SIZE,
  specialIdAt,
  sectorIndexFromDelta,
} from "../utils/circle-keypad-geometry.ts";

// スワイプで起動するサークルキーパッド。
// ターミナル上でタッチ起点から一定距離（CIRCLE_KEYPAD_TRIGGER_PX）動かしたら起点に円形メニューを表示し、
// 指を離した方向に応じてキーを送信する。中心付近で離した場合はキャンセル。
export const CIRCLE_KEYPAD_TRIGGER_PX = 36;

// 幾何計算と関連定数は circle-keypad-geometry.js に分離（テスト容易化）。既存の import 互換のため再エクスポートする。
export { CIRCLE_KEYPAD_ANGLES, SPECIAL_POSITIONS, SPECIAL_BUTTON_SIZE };

export function useCircleKeyPad() {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const layoutStore = useLayoutStore();
  const config = useCircleKeyPadConfigStore();

  // ストアから読んだ keyDef を表示用 items に整形する。
  const keys = computed(() => config.keys.map((k, i) => ({
    id: `key:${i}`,
    angle: CIRCLE_KEYPAD_ANGLES[i],
    label: k.label || k.key || "",
    keyDef: { key: k.key, ctrl: !!k.ctrl, shift: !!k.shift, alt: !!k.alt },
  })));

  const specials = computed(() => config.specials.map((s, i) => ({
    id: `special:${i}`,
    label: s.label || s.action || "",
    action: s.action,
    payload: s.payload || null,
    offsetX: SPECIAL_POSITIONS[i].offsetX,
    offsetY: SPECIAL_POSITIONS[i].offsetY,
  })));

  const state = reactive({
    visible: false,
    originX: 0,
    originY: 0,
    activeId: null as string | null,
  });

  function open(x: number, y: number) {
    state.originX = x;
    state.originY = y;
    state.activeId = null;
    state.visible = true;
  }

  function update(x: number, y: number) {
    if (!state.visible) return;
    const dx = x - state.originX;
    const dy = y - state.originY;
    const specialId = specialIdAt(dx, dy);
    if (specialId) {
      const idx = Number(specialId.slice("special:".length));
      // action 未割り当て（None）のコーナーはヒット判定しても表示・アクティブ化しない
      state.activeId = specials.value[idx]?.action ? specialId : null;
      return;
    }
    const idx = sectorIndexFromDelta(dx, dy);
    state.activeId = idx == null ? null : `key:${idx}`;
  }

  function emitSpecial(s: { action: string, payload: object | null }, tab: TerminalTab | null | undefined) {
    if (s.action === "selection:open") {
      if (tab?.workspace) workspaceStore.selectedWorkspace = tab.workspace;
      bridgeEmit("git:openFileModal", { pane: "select" });
      return;
    }
    if (s.action === "app:reload") {
      window.location.reload();
      return;
    }
    if (s.action === "terminal:scrollToBottom") {
      tab?.term?.scrollToBottom?.();
      return;
    }
    if (s.action === "terminal:scrollToTop") {
      tab?.term?.scrollToTop?.();
      return;
    }
    if (s.action === "terminal:clear") {
      dispatchTextToTab(tab, "\x0c"); // Ctrl+L 相当
      return;
    }
    if (s.action === "terminal:paste") {
      navigator.clipboard?.readText?.().then((text) => {
        if (text) dispatchTextToTab(tab, text);
      }).catch(() => { /* permission denied */ });
      return;
    }
    if (s.action === "tab:refresh") {
      bridgeEmit("tab:refresh", { tab });
      return;
    }
    if (s.action === "tab:close") {
      bridgeEmit("tab:close", { tab });
      return;
    }
    if (s.action === "tab:hide") {
      if (tab?.id != null) terminalStore.detachTab(tab.id);
      return;
    }
    if (s.action === "tab:next" || s.action === "tab:prev") {
      const tabs = terminalStore.openTabs;
      if (tabs.length < 2) return;
      const refId = tab?.id ?? terminalStore.activeTabId;
      const cur = tabs.findIndex((t) => t.id === refId);
      if (cur < 0) return;
      const delta = s.action === "tab:next" ? 1 : -1;
      const next = tabs[(cur + delta + tabs.length) % tabs.length];
      if (next) bridgeEmit("tab:select", { tab: next });
      return;
    }
    if (s.action === "layout:splitToggle") {
      if (layoutStore.isSplitMode) {
        layoutStore.exitSplitMode?.();
      } else {
        const ids = terminalStore.openTabs.map((t) => t.id);
        if (ids.length >= 2) {
          layoutStore.splitPaneTabIds = ids;
          layoutStore.activePaneIndex = 0;
          layoutStore.isSplitMode = true;
        }
      }
      return;
    }
    if (s.action === "terminal:newForWorkspace") {
      bridgeEmit("terminal:launch", tab?.workspace ? { workspace: tab.workspace } : {});
      return;
    }
    // git:* 系（WorkspaceDetail を開く）はそのターミナルのワークスペースを選択した状態で開く。
    if (s.action?.startsWith("git:") && tab?.workspace) {
      workspaceStore.selectedWorkspace = tab.workspace;
    }
    if (!s.action) return;
    bridgeEmit(s.action, s.payload);
  }

  function commitAndClose(tab: TerminalTab | null | undefined) {
    const id = state.activeId;
    state.visible = false;
    state.activeId = null;
    if (!id) return;
    if (id.startsWith("special:")) {
      const idx = Number(id.slice("special:".length));
      const s = specials.value[idx];
      if (s) emitSpecial(s, tab);
      return;
    }
    if (id.startsWith("key:")) {
      const idx = Number(id.slice("key:".length));
      const k = keys.value[idx];
      if (!k?.keyDef?.key) return;
      dispatchKeyToTab(tab, k.keyDef);
    }
  }

  function cancel() {
    state.visible = false;
    state.activeId = null;
  }

  const enabled = computed(() => config.enabled);

  return { state, open, update, commitAndClose, cancel, keys, specials, enabled };
}
