// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useTerminalStore } from "../../ui/stores/terminal.ts";
import { useWorkspaceStore } from "../../ui/stores/workspace.ts";
import { on } from "../../ui/app-bridge.ts";
import { EP_JOBS_WORKSPACES, EP_TERMINAL_SESSIONS } from "../../ui/utils/endpoints.ts";

const apiGetMock = vi.fn();

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({ apiGet: apiGetMock }),
}));

const { useSessionTabAttach } = await import("../../ui/composables/useSessionTabAttach.ts");

function mockSessions(sessions) {
  apiGetMock.mockImplementation(async (endpoint) => {
    if (endpoint === EP_TERMINAL_SESSIONS) return { ok: true, data: sessions };
    if (endpoint === EP_JOBS_WORKSPACES) return { ok: true, data: {} };
    return { ok: false, data: null };
  });
}

describe("useSessionTabAttach", () => {
  let selected;
  let off;

  beforeEach(() => {
    setActivePinia(createPinia());
    apiGetMock.mockReset();
    selected = [];
    off = on("tab:select", (detail) => selected.push(detail));
  });

  afterEach(() => {
    off();
  });

  it("既存タブはAPIを呼ばずに選択し、created=falseを返す", async () => {
    const terminalStore = useTerminalStore();
    const tab = { id: 1, sessionId: "sess1", workspace: "ws1" };
    terminalStore.openTabs.push(tab);

    const result = await useSessionTabAttach().attachSessionTab("sess1", { restored: true });

    expect(result).toEqual({ tab, created: false });
    expect(selected).toEqual([{ tab }]);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("サーバに無いセッションはnullを返し、ワークスペース選択もタブ選択もしない", async () => {
    mockSessions([{ session_id: "other" }]);
    const workspaceStore = useWorkspaceStore();

    const result = await useSessionTabAttach().attachSessionTab("sess1", { restored: false, workspace: "ws1" });

    expect(result).toBeNull();
    expect(selected).toEqual([]);
    expect(workspaceStore.selectedWorkspace).not.toBe("ws1");
  });

  it("未オープンのセッションはタブを作ってrestoredを反映し、指定ワークスペースを選択する", async () => {
    mockSessions([{ session_id: "sess1", workspace: "ws1", ws_url: "/terminal/ws/sess1" }]);
    const terminalStore = useTerminalStore();
    const workspaceStore = useWorkspaceStore();
    const addSpy = vi.spyOn(terminalStore, "addTerminalTab").mockImplementation((params) => ({ id: 9, sessionId: "sess1", ...params }));

    const result = await useSessionTabAttach().attachSessionTab("sess1", { restored: false, workspace: "ws1" });

    expect(result?.created).toBe(true);
    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ restored: false }));
    expect(workspaceStore.selectedWorkspace).toBe("ws1");
    expect(selected).toEqual([{ tab: result?.tab }]);
  });
});
