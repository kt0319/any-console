import { reactive } from "vue";
import { keyDefToAnsi } from "../utils/key-ansi.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { getFullBufferText } from "../utils/terminal-buffer-text.js";
import { useWorkspaceStore } from "../stores/workspace.js";

// スワイプで起動するサークルキーパッド。
// ターミナル上でタッチ起点から一定距離（RADIAL_TRIGGER_PX）動かしたら起点に円形メニューを表示し、
// 指を離した方向に応じてキーを送信する。中心付近で離した場合はキャンセル。
export const RADIAL_TRIGGER_PX = 36;
const RADIAL_DEADZONE_PX = 40;
// 各セクターの中心 ±SECTOR_HALF° のみキー判定。隙間（中心から ±18°超〜±22.5°）はキャンセル。
const SECTOR_HALF_DEG = 18;

// N から時計回り 45° 刻みで 8 セクター。
export const RADIAL_KEYS = [
  { id: "up",      label: "↑",   angle: -90,  keyDef: { key: "ArrowUp" } },
  { id: "tab",     label: "Tab", angle: -45,  keyDef: { key: "Tab" } },
  { id: "right",   label: "→",   angle: 0,    keyDef: { key: "ArrowRight" } },
  { id: "enter",   label: "↵",   angle: 45,   keyDef: { key: "Enter" } },
  { id: "down",    label: "↓",   angle: 90,   keyDef: { key: "ArrowDown" } },
  { id: "esc",     label: "Esc", angle: 135,  keyDef: { key: "Escape" } },
  { id: "left",    label: "←",   angle: 180,  keyDef: { key: "ArrowLeft" } },
  { id: "ctrl_c",  label: "^C",  angle: -135, keyDef: { key: "c", ctrl: true } },
];

// サークルとは独立した特殊メニューボタン。サークル原点から四隅にオフセットして配置する。
// 当たり判定は矩形に指が入っているかで決める。
const SPECIAL_WIDTH = 80;
const SPECIAL_HEIGHT = 34;
const SPECIAL_OFFSET = 100;
export const SPECIAL_BUTTONS = [
  { id: "workspace", label: "Workspace", offsetX: -SPECIAL_OFFSET, offsetY: -SPECIAL_OFFSET, action: "workspace:openModal" },
  { id: "jobs",      label: "Jobs",      offsetX:  SPECIAL_OFFSET, offsetY: -SPECIAL_OFFSET, action: "settings:open", payload: { view: "JobConfig" } },
  { id: "selcopy",   label: "Sel & Copy", offsetX: -SPECIAL_OFFSET, offsetY: SPECIAL_OFFSET, action: "selection:open" },
  { id: "settings",  label: "Settings",  offsetX:  SPECIAL_OFFSET, offsetY: SPECIAL_OFFSET, action: "settings:open" },
];

export const SPECIAL_BUTTON_SIZE = { width: SPECIAL_WIDTH, height: SPECIAL_HEIGHT };

function findSpecialAt(dx, dy) {
  const halfW = SPECIAL_WIDTH / 2;
  const halfH = SPECIAL_HEIGHT / 2;
  for (const b of SPECIAL_BUTTONS) {
    if (dx >= b.offsetX - halfW && dx <= b.offsetX + halfW
      && dy >= b.offsetY - halfH && dy <= b.offsetY + halfH) {
      return b.id;
    }
  }
  return null;
}

function sectorIdFromDelta(dx, dy) {
  const dist = Math.hypot(dx, dy);
  if (dist < RADIAL_DEADZONE_PX) return null;
  const deg = Math.atan2(dy, dx) * (180 / Math.PI);
  for (const k of RADIAL_KEYS) {
    let diff = deg - k.angle;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    if (Math.abs(diff) < SECTOR_HALF_DEG) return k.id;
  }
  return null;
}

export function useRadialKey() {
  const workspaceStore = useWorkspaceStore();
  const state = reactive({
    visible: false,
    originX: 0,
    originY: 0,
    activeId: /** @type {string | null} */ (null),
  });

  function open(x, y) {
    state.originX = x;
    state.originY = y;
    state.activeId = null;
    state.visible = true;
  }

  function update(x, y) {
    if (!state.visible) return;
    const dx = x - state.originX;
    const dy = y - state.originY;
    const specialId = findSpecialAt(dx, dy);
    if (specialId) {
      state.activeId = specialId;
      return;
    }
    state.activeId = sectorIdFromDelta(dx, dy);
  }

  function emitSpecial(button, tab) {
    if (button.action === "selection:open") {
      bridgeEmit("selection:open", { tab, fallbackText: getFullBufferText(tab?.term) });
      return;
    }
    // Jobs はそのターミナルのワークスペース選択状態で開く。
    if (button.id === "jobs" && tab?.workspace) {
      workspaceStore.selectedWorkspace = tab.workspace;
    }
    bridgeEmit(button.action, button.payload);
  }

  function commitAndClose(tab) {
    const id = state.activeId;
    state.visible = false;
    state.activeId = null;
    if (!id) return;
    const special = SPECIAL_BUTTONS.find((b) => b.id === id);
    if (special) {
      emitSpecial(special, tab);
      return;
    }
    const k = RADIAL_KEYS.find((r) => r.id === id);
    if (!k?.keyDef) return;
    const seq = keyDefToAnsi(k.keyDef);
    if (!seq) return;
    if (tab?.ws && tab.ws.readyState === WebSocket.OPEN) {
      tab.ws.send(new TextEncoder().encode(seq));
    }
  }

  function cancel() {
    state.visible = false;
    state.activeId = null;
  }

  return { state, open, update, commitAndClose, cancel };
}
