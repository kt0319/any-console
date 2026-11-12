// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: AuthConfig（API トークン） */
import { ref } from "vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useConfirm } from "../../../ui/composables/useConfirm.ts";
import AuthConfig from "../../../ui/components/AuthConfig.vue";
import { EP_API_TOKENS, EP_SETTINGS_AUTH } from "../../../ui/utils/endpoints.ts";

// ── AuthConfig: API Tokens ────────────────────────────────────────────────

describe("AuthConfig: API Tokens", () => {
  /** @type {import("vitest").Mock} */
  let fetchMock;

  function jsonResponse(data, status = 200) {
    return Promise.resolve({ ok: status < 400, status, json: async () => data });
  }

  function stubFetch(handlers) {
    fetchMock = vi.fn((url, opts = {}) => {
      const method = opts.method || "GET";
      for (const [matchUrl, matchMethod, respond] of handlers) {
        if (url === matchUrl && method === matchMethod) return respond();
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("既存トークンを一覧表示する（scope チップ・Last used 込み）", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([
        { id: "tok_1", name: "github-actions", scope: "dispatch", last_used: null },
      ])],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();

    expect(wrapper.text()).toContain("github-actions");
    expect(wrapper.text()).toContain("dispatch");
    expect(wrapper.text()).toContain("Never");
    wrapper.unmount();
  });

  it("作成すると raw トークンを一度だけ表示し、一覧を再読込する", async () => {
    let listCallCount = 0;
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => {
        listCallCount += 1;
        const data = listCallCount === 1 ? [] : [{ id: "tok_2", name: "ci", scope: "dispatch", last_used: null }];
        return jsonResponse(data);
      }],
      [EP_API_TOKENS, "POST", () => jsonResponse({
        id: "tok_2", name: "ci", scope: "dispatch", last_used: null, token: "raw-secret-value",
      })],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();

    await wrapper.find('input[placeholder^="Token name"]').setValue("ci");
    const createBtn = wrapper.findAll("button").find((b) => b.text() === "Create");
    await createBtn.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Copy this token now");
    expect(wrapper.find(".security-token-row input[readonly]").element.value).toBe("raw-secret-value");
    expect(wrapper.text()).toContain("ci");
    expect(listCallCount).toBe(2);
    wrapper.unmount();
  });

  it("Copy ボタンでクリップボードへコピーする", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "POST", () => jsonResponse({
        id: "tok_3", name: "ci", scope: "dispatch", last_used: null, token: "copy-me-token",
      })],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    await wrapper.find('input[placeholder^="Token name"]').setValue("ci");
    await wrapper.findAll("button").find((b) => b.text() === "Create").trigger("click");
    await flushPromises();

    const copyBtn = wrapper.find('button[aria-label="Copy token"]');
    await copyBtn.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("copy-me-token");
    Object.defineProperty(navigator, "clipboard", { value: origClipboard, configurable: true });
    wrapper.unmount();
  });

  it("Revoke は useConfirm 経由で確認してから削除する", async () => {
    let deleteCalled = false;
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse(
        deleteCalled ? [] : [{ id: "tok_4", name: "ci", scope: "dispatch", last_used: null }],
      )],
      ["/api-tokens/tok_4", "DELETE", () => {
        deleteCalled = true;
        return jsonResponse({ ok: true });
      }],
    ]);

    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    expect(wrapper.text()).toContain("ci");

    const confirmState = useConfirm();
    const revokeBtn = wrapper.find('button[aria-label="Revoke API token"]');
    const clickPromise = revokeBtn.trigger("click");
    await Promise.resolve();
    await flushPromises();
    confirmState.onOk();
    await clickPromise;
    await flushPromises();

    expect(deleteCalled).toBe(true);
    expect(wrapper.text()).not.toContain("ci");
    wrapper.unmount();
  });

  it("scope の既定は dispatch で、direct を選んだときだけ回数・ワークスペースの入力が出る（期限は両方）", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
      ["/workspaces", "GET", () => jsonResponse([{ name: "proj" }, { name: "other" }])],
    ]);
    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();

    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios.map((r) => r.element.value)).toEqual(["dispatch", "direct"]);
    expect(radios[0].element.checked).toBe(true);
    expect(wrapper.find('input[type="datetime-local"]').exists()).toBe(true);
    expect(wrapper.find('input[type="number"]').exists()).toBe(false);
    expect(wrapper.find(".api-token-limits select").exists()).toBe(false);

    await radios[1].setValue(true);
    expect(wrapper.find('input[type="number"]').exists()).toBe(true);
    const options = wrapper.findAll(".api-token-limits select option");
    expect(options.map((o) => o.text())).toEqual(["All workspaces", "proj", "other"]);
    expect(wrapper.findAll('.api-token-limits input[type="checkbox"]')).toHaveLength(0);
    wrapper.unmount();
  });

  it("dispatch スコープの作成は制限を送らない", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "POST", () => jsonResponse({ id: "tok_5", name: "ci", scope: "dispatch", token: "t" })],
    ]);
    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    await wrapper.find('input[placeholder^="Token name"]').setValue("ci");
    await wrapper.findAll("button").find((b) => b.text() === "Create").trigger("click");
    await flushPromises();

    const post = fetchMock.mock.calls.find(([url, opts]) => url === EP_API_TOKENS && opts?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({ name: "ci", scope: "dispatch" });
    wrapper.unmount();
  });

  it("direct スコープの作成は max_per_day・allowed_workspaces・expires_at を送る", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
      ["/workspaces", "GET", () => jsonResponse([{ name: "proj" }, { name: "other" }])],
      [EP_API_TOKENS, "POST", () => jsonResponse({ id: "tok_6", name: "cron", scope: "direct", token: "t" })],
    ]);
    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    await wrapper.find('input[placeholder^="Token name"]').setValue("cron");
    await wrapper.findAll('input[type="radio"]')[1].setValue(true);
    await wrapper.find('input[type="number"]').setValue(3);
    await wrapper.find('input[type="datetime-local"]').setValue("2099-01-02T03:04");
    await wrapper.find(".api-token-limits select").setValue("proj");
    await wrapper.findAll("button").find((b) => b.text() === "Create").trigger("click");
    await flushPromises();

    const post = fetchMock.mock.calls.find(([url, opts]) => url === EP_API_TOKENS && opts?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({
      name: "cron",
      scope: "direct",
      max_per_day: 3,
      allowed_workspaces: ["proj"],
      expires_at: Math.floor(new Date("2099-01-02T03:04").getTime() / 1000),
    });
    wrapper.unmount();
  });

  it("direct でワークスペースを選ばなければ allowed_workspaces を送らない", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
      ["/workspaces", "GET", () => jsonResponse([{ name: "proj" }])],
      [EP_API_TOKENS, "POST", () => jsonResponse({ id: "tok_10", name: "cron", scope: "direct", token: "t" })],
    ]);
    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    await wrapper.find('input[placeholder^="Token name"]').setValue("cron");
    await wrapper.findAll('input[type="radio"]')[1].setValue(true);
    await wrapper.findAll("button").find((b) => b.text() === "Create").trigger("click");
    await flushPromises();

    const post = fetchMock.mock.calls.find(([url, opts]) => url === EP_API_TOKENS && opts?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({ name: "cron", scope: "direct", max_per_day: 10 });
    wrapper.unmount();
  });

  it("dispatch スコープでも有効期限を送り、過去の期限なら Create を無効にする", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "POST", () => jsonResponse({ id: "tok_11", name: "ci", scope: "dispatch", token: "t" })],
    ]);
    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    await wrapper.find('input[placeholder^="Token name"]').setValue("ci");
    const createBtn = () => wrapper.findAll("button").find((b) => b.text() === "Create");

    await wrapper.find('input[type="datetime-local"]').setValue("2000-01-01T00:00");
    expect(createBtn().element.disabled).toBe(true);
    await wrapper.find('input[type="datetime-local"]').setValue("2099-01-02T03:04");
    expect(createBtn().element.disabled).toBe(false);
    await createBtn().trigger("click");
    await flushPromises();

    const post = fetchMock.mock.calls.find(([url, opts]) => url === EP_API_TOKENS && opts?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({
      name: "ci",
      scope: "dispatch",
      expires_at: Math.floor(new Date("2099-01-02T03:04").getTime() / 1000),
    });
    wrapper.unmount();
  });

  it("direct の max_per_day が負数、または有効期限が過去なら Create を無効にする", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([])],
    ]);
    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();
    await wrapper.find('input[placeholder^="Token name"]').setValue("cron");
    await wrapper.findAll('input[type="radio"]')[1].setValue(true);
    const createBtn = () => wrapper.findAll("button").find((b) => b.text() === "Create");
    expect(createBtn().element.disabled).toBe(false);

    await wrapper.find('input[type="number"]').setValue(-1);
    expect(createBtn().element.disabled).toBe(true);
    await wrapper.find('input[type="number"]').setValue(0);
    expect(createBtn().element.disabled).toBe(false);
    expect(createBtn().element.disabled).toBe(false);

    await wrapper.find('input[type="datetime-local"]').setValue("2000-01-01T00:00");
    expect(createBtn().element.disabled).toBe(true);
    wrapper.unmount();
  });

  it("一覧は direct トークンの制限と最終使用日時を表示し、dispatch には出さない", async () => {
    stubFetch([
      [EP_SETTINGS_AUTH, "GET", () => jsonResponse({ auth_required: true })],
      ["/devices", "GET", () => jsonResponse([])],
      [EP_API_TOKENS, "GET", () => jsonResponse([
        { id: "tok_7", name: "cron", scope: "direct", max_per_day: 5, allowed_workspaces: ["proj", "other"], expires_at: 4102444800, last_used: null },
        { id: "tok_8", name: "old", scope: "direct", max_per_day: 10, expires_at: 946684800, last_used: null },
        { id: "tok_9", name: "ci", scope: "dispatch", last_used: null },
        { id: "tok_10", name: "ci2", scope: "dispatch", expires_at: 4102444800, last_used: null },
        { id: "tok_11", name: "free", scope: "direct", max_per_day: 0, last_used: null },
      ])],
    ]);
    const wrapper = mount(AuthConfig, { global: { provide: { modalTitle: ref("") } } });
    await flushPromises();

    const rows = wrapper.findAll(".device-row");
    expect(rows[0].find(".device-tag").text()).toBe("direct");
    expect(rows[0].text()).toContain("Max 5/day");
    expect(rows[0].text()).toContain("Workspaces: proj, other");
    expect(rows[0].text()).toContain("Expires");
    expect(rows[0].text()).toContain("Last used: Never");
    expect(rows[1].text()).toContain("Workspaces: all");
    expect(rows[1].text()).toContain("Expired");
    expect(rows[4].text()).toContain("Unlimited runs");
    expect(rows[4].text()).not.toContain("Max");
    expect(rows[2].find(".device-tag").text()).toBe("dispatch");
    expect(rows[2].text()).not.toContain("Max");
    expect(rows[2].text()).not.toContain("Expire");
    expect(rows[3].find(".device-tag").text()).toBe("dispatch");
    expect(rows[3].text()).toContain("Expires");
    expect(rows[3].text()).not.toContain("Max");
    wrapper.unmount();
  });
});
