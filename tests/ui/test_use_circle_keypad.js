// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useCircleKeyPad } from "../../ui/composables/useCircleKeyPad.js";
import { useCircleKeyPadConfigStore } from "../../ui/stores/circle-keypad-config.js";
import { SPECIAL_POSITIONS } from "../../ui/utils/circle-keypad-geometry.ts";

describe("useCircleKeyPad: コーナーアクション None", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("action が空のコーナーはヒット領域内でも activeId にならない", () => {
    const config = useCircleKeyPadConfigStore();
    config.specials = [
      { label: "", action: "", payload: null },
      { label: "Jobs", action: "git:openFileModal", payload: { pane: "jobs" } },
      { label: "", action: "", payload: null },
      { label: "", action: "", payload: null },
    ];

    const pad = useCircleKeyPad();
    pad.open(0, 0);

    // 左上（specials[0], action なし）: ヒット領域内でも activeId は立たない
    const topLeft = SPECIAL_POSITIONS[0];
    pad.update(topLeft.offsetX, topLeft.offsetY);
    expect(pad.state.activeId).toBeNull();

    // 右上（specials[1], action あり）: 通常通りヒットする
    const topRight = SPECIAL_POSITIONS[1];
    pad.update(topRight.offsetX, topRight.offsetY);
    expect(pad.state.activeId).toBe("special:1");
  });

  it("computed specials は action 空でもエントリ自体は保持する（位置インデックス整合のため）", () => {
    const config = useCircleKeyPadConfigStore();
    config.specials = [
      { label: "", action: "", payload: null },
      { label: "Jobs", action: "git:openFileModal", payload: { pane: "jobs" } },
      { label: "", action: "", payload: null },
      { label: "", action: "", payload: null },
    ];

    const pad = useCircleKeyPad();
    expect(pad.specials.value).toHaveLength(4);
    expect(pad.specials.value[0].action).toBe("");
    expect(pad.specials.value[1].action).toBe("git:openFileModal");
  });

  it("PageUp / PageDown を ANSI シーケンスとしてターミナルへ送る", () => {
    const config = useCircleKeyPadConfigStore();
    config.keys = [
      { key: "PageUp", ctrl: false, shift: false, alt: false, label: "PgUp" },
      { key: "PageDown", ctrl: false, shift: false, alt: false, label: "PgDn" },
      { key: "", ctrl: false, shift: false, alt: false, label: "" },
      { key: "", ctrl: false, shift: false, alt: false, label: "" },
      { key: "", ctrl: false, shift: false, alt: false, label: "" },
      { key: "", ctrl: false, shift: false, alt: false, label: "" },
      { key: "", ctrl: false, shift: false, alt: false, label: "" },
      { key: "", ctrl: false, shift: false, alt: false, label: "" },
    ];
    const sent = [];
    const tab = {
      ws: {
        readyState: WebSocket.OPEN,
        send: vi.fn((bytes) => sent.push(new TextDecoder().decode(bytes))),
      },
    };

    const pad = useCircleKeyPad();
    pad.open(0, 0);
    pad.state.activeId = "key:0";
    pad.commitAndClose(tab);
    pad.open(0, 0);
    pad.state.activeId = "key:1";
    pad.commitAndClose(tab);

    expect(sent).toEqual(["\x1b[5~", "\x1b[6~"]);
  });
});
