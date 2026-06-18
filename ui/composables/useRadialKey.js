import { computed, reactive } from "vue";
import { keyDefToAnsi } from "../utils/key-ansi.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { getFullBufferText } from "../utils/terminal-buffer-text.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useRadialConfigStore } from "../stores/radial-config.js";

// スワイプで起動するサークルキーパッド。
// ターミナル上でタッチ起点から一定距離（RADIAL_TRIGGER_PX）動かしたら起点に円形メニューを表示し、
// 指を離した方向に応じてキーを送信する。中心付近で離した場合はキャンセル。
export const RADIAL_TRIGGER_PX = 36;
const RADIAL_DEADZONE_PX = 40;
// 各セクターの中心 ±SECTOR_HALF° のみキー判定。隙間（中心から ±18°超〜±22.5°）はキャンセル。
const SECTOR_HALF_DEG = 18;

// N から時計回り 45° 刻みで 8 セクター。
export const RADIAL_ANGLES = [-90, -45, 0, 45, 90, 135, 180, -135];

const SPECIAL_WIDTH = 80;
const SPECIAL_HEIGHT = 34;
const SPECIAL_OFFSET = 100;
// 四隅の配置順: 左上 / 右上 / 左下 / 右下（store の specials と同じ順）。
export const SPECIAL_POSITIONS = [
  { offsetX: -SPECIAL_OFFSET, offsetY: -SPECIAL_OFFSET },
  { offsetX:  SPECIAL_OFFSET, offsetY: -SPECIAL_OFFSET },
  { offsetX: -SPECIAL_OFFSET, offsetY:  SPECIAL_OFFSET },
  { offsetX:  SPECIAL_OFFSET, offsetY:  SPECIAL_OFFSET },
];

export const SPECIAL_BUTTON_SIZE = { width: SPECIAL_WIDTH, height: SPECIAL_HEIGHT };

function specialIdAt(dx, dy) {
  const halfW = SPECIAL_WIDTH / 2;
  const halfH = SPECIAL_HEIGHT / 2;
  for (let i = 0; i < SPECIAL_POSITIONS.length; i++) {
    const p = SPECIAL_POSITIONS[i];
    if (dx >= p.offsetX - halfW && dx <= p.offsetX + halfW
      && dy >= p.offsetY - halfH && dy <= p.offsetY + halfH) {
      return `special:${i}`;
    }
  }
  return null;
}

function sectorIndexFromDelta(dx, dy) {
  const dist = Math.hypot(dx, dy);
  if (dist < RADIAL_DEADZONE_PX) return null;
  const deg = Math.atan2(dy, dx) * (180 / Math.PI);
  for (let i = 0; i < RADIAL_ANGLES.length; i++) {
    let diff = deg - RADIAL_ANGLES[i];
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    if (Math.abs(diff) < SECTOR_HALF_DEG) return i;
  }
  return null;
}

export function useRadialKey() {
  const workspaceStore = useWorkspaceStore();
  const config = useRadialConfigStore();

  // ストアから読んだ keyDef を表示用 items に整形する。
  const keys = computed(() => config.keys.map((k, i) => ({
    id: `key:${i}`,
    angle: RADIAL_ANGLES[i],
    label: k.label || k.key || "",
    keyDef: { key: k.key, ctrl: !!k.ctrl, shift: !!k.shift },
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
    const specialId = specialIdAt(dx, dy);
    if (specialId) {
      state.activeId = specialId;
      return;
    }
    const idx = sectorIndexFromDelta(dx, dy);
    state.activeId = idx == null ? null : `key:${idx}`;
  }

  function emitSpecial(s, tab) {
    if (s.action === "selection:open") {
      bridgeEmit("selection:open", { tab, fallbackText: getFullBufferText(tab?.term) });
      return;
    }
    // git:* 系（WorkspaceDetail を開く）はそのターミナルのワークスペースを選択した状態で開く。
    if (s.action?.startsWith("git:") && tab?.workspace) {
      workspaceStore.selectedWorkspace = tab.workspace;
    }
    if (!s.action) return;
    bridgeEmit(s.action, s.payload);
  }

  function commitAndClose(tab) {
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
      const seq = keyDefToAnsi(k.keyDef);
      if (!seq) return;
      if (tab?.ws && tab.ws.readyState === WebSocket.OPEN) {
        tab.ws.send(new TextEncoder().encode(seq));
      }
    }
  }

  function cancel() {
    state.visible = false;
    state.activeId = null;
  }

  return { state, open, update, commitAndClose, cancel, keys, specials };
}
