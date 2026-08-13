// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useDeepLink } from "../../ui/composables/useDeepLink.ts";
import { useTerminalStore } from "../../ui/stores/terminal.ts";
import { on } from "../../ui/app-bridge.js";

describe("useDeepLink: attachSessionTab", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("既存タブへの再アタッチでも tab:select を発火する（設定モーダルの自動クローズに必要）", async () => {
    const terminalStore = useTerminalStore();
    const tab = { id: "tab1", sessionId: "sess1", workspace: "ws1" };
    terminalStore.openTabs.push(tab);

    const selected = [];
    const off = on("tab:select", (detail) => selected.push(detail));

    const { attachSessionTab } = useDeepLink();
    const attached = await attachSessionTab("sess1");

    expect(attached).toBe(true);
    expect(selected).toEqual([{ tab }]);

    off();
  });
});
