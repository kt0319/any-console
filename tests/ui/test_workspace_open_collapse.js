// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { LS_KEY_COLLAPSED_WORKSPACE_GROUPS } from "../../ui/utils/constants.ts";

async function mountWorkspaceOpen() {
  vi.resetModules();
  setActivePinia(createPinia());
  const { useWorkspaceStore } = await import("../../ui/stores/workspace.ts");
  const store = useWorkspaceStore();
  await Promise.all([store.fetchGroups(), store.fetchWorkspaces()]);
  const { default: WorkspaceOpen } = await import("../../ui/components/WorkspaceOpen.vue");
  const wrapper = mount(WorkspaceOpen, { global: { provide: { modalTitle: ref("") } } });
  await flushPromises();
  return wrapper;
}

describe("WorkspaceOpen: グループの折りたたみ状態の永続化", () => {
  beforeEach(() => {
    const responses = {
      "/groups": [{ id: "g1", name: "Group One" }],
      "/workspaces": [{ name: "a", path: "/a", group_id: "g1" }],
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, status: 200, json: async () => responses[url] ?? [] })));
    localStorage.clear();
  });

  it("トグルした状態が localStorage に保存され、再読み込み後も維持される", async () => {
    const first = await mountWorkspaceOpen();
    await first.find(".ws-group-toggle").trigger("click");
    expect(JSON.parse(localStorage.getItem(LS_KEY_COLLAPSED_WORKSPACE_GROUPS))).toEqual(["g1"]);
    first.unmount();

    const second = await mountWorkspaceOpen();
    expect(second.find(".ws-group-chevron").classes()).toContain("mdi-chevron-right");
    await second.find(".ws-group-toggle").trigger("click");
    expect(JSON.parse(localStorage.getItem(LS_KEY_COLLAPSED_WORKSPACE_GROUPS))).toEqual([]);
    second.unmount();
  });
});
