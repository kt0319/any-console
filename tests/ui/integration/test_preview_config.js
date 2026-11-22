// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: PreviewConfig（プレビュー proxy の HTTPS 切替） */
import { ref } from "vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PreviewConfig from "../../../ui/components/PreviewConfig.vue";
import { EP_SETTINGS_PREVIEW, EP_SYSTEM_INFO } from "../../../ui/utils/endpoints.ts";

describe("PreviewConfig", () => {
  /** @type {import("vitest").Mock} */
  let fetchMock;

  function jsonResponse(data, status = 200) {
    return Promise.resolve({ ok: status < 400, status, json: async () => data });
  }

  function stubFetch({ https, certificate, putStatus = 200 }) {
    fetchMock = vi.fn((url, opts = {}) => {
      const method = opts.method || "GET";
      if (url === EP_SETTINGS_PREVIEW && method === "GET") return jsonResponse({ https });
      if (url === EP_SETTINGS_PREVIEW && method === "PUT") return jsonResponse({ status: "ok" }, putStatus);
      if (url === EP_SYSTEM_INFO) return jsonResponse({ preview_https: certificate });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  function mountConfig() {
    return mount(PreviewConfig, {
      attachTo: document.body,
      global: { provide: { modalTitle: ref(""), modalBranch: ref(""), pushView: () => {}, popView: () => {} } },
    });
  }

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("保存済みの設定をチェックボックスに反映する", async () => {
    stubFetch({ https: false, certificate: true });
    const wrapper = mountConfig();
    await flushPromises();
    expect(wrapper.find("input[type=checkbox]").element.checked).toBe(false);
    wrapper.unmount();
  });

  it("有効かつ証明書が無いときだけ案内を出す", async () => {
    stubFetch({ https: true, certificate: false });
    const wrapper = mountConfig();
    await flushPromises();
    expect(wrapper.text()).toContain("./any-console https-setup");
    wrapper.unmount();

    stubFetch({ https: true, certificate: true });
    const withCert = mountConfig();
    await flushPromises();
    expect(withCert.text()).not.toContain("./any-console https-setup");
    withCert.unmount();
  });

  it("切り替えると PUT で保存する", async () => {
    stubFetch({ https: true, certificate: true });
    const wrapper = mountConfig();
    await flushPromises();
    const checkbox = wrapper.find("input[type=checkbox]");
    checkbox.element.checked = false;
    await checkbox.trigger("change");
    await flushPromises();
    const put = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT");
    expect(JSON.parse(put[1].body)).toEqual({ https: false });
    wrapper.unmount();
  });
});
