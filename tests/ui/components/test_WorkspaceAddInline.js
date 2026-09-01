// @vitest-environment happy-dom
/**
 * WorkspaceAddInline: グループが存在する場合のみGroupセレクトを表示し、
 * 選択したgroup_idを登録リクエストに含めることを確認する。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { computed, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import WorkspaceAddInline from "../../../ui/components/WorkspaceAddInline.vue";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";

function jsonResponse(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data });
}

// useModalView() が inject するキー一式。実行時は SessionOpenModal.vue 等が
// provideModalView() 経由で提供するが、ユニットテストでは最小限を手動 provide する。
function mountOptions() {
  return {
    global: {
      provide: {
        modalTitle: ref(""),
        modalBranch: ref(""),
        viewState: computed(() => ({})),
        pushView: () => {},
        popView: () => {},
        updateViewState: () => {},
      },
    },
  };
}

describe("WorkspaceAddInline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("グループが無ければGroupセレクトを表示しない", () => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ base: "", entries: [] })));

    const wrapper = mount(WorkspaceAddInline, mountOptions());
    expect(wrapper.find("select").exists()).toBe(false);
    wrapper.unmount();
  });

  it("グループがあればGroupセレクトを表示し、選択したgroup_idを送信する", async () => {
    setActivePinia(createPinia());
    const ws = useWorkspaceStore();
    ws.groups = [{ id: "grp_1", name: "Team A" }];
    const fetchMock = vi.fn((url, opts = {}) => {
      if (opts.method === "POST") {
        return jsonResponse({ status: "ok", name: "myproj" });
      }
      return jsonResponse({ base: "", entries: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(WorkspaceAddInline, mountOptions());
    const select = wrapper.find("select");
    expect(select.exists()).toBe(true);
    await select.setValue("grp_1");
    await wrapper.find("input.ws-add-input").setValue("/tmp/myproj");
    await wrapper.find(".ws-add-submit-btn").trigger("click");
    await flushPromises();

    const postCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall[1].body);
    expect(body.group_id).toBe("grp_1");
    wrapper.unmount();
  });
});
