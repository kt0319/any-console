// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

async function mountSessionOpenHome() {
  vi.resetModules();
  setActivePinia(createPinia());
  const { useWorkspaceStore } = await import("../../../ui/stores/workspace.ts");
  const store = useWorkspaceStore();
  await Promise.all([store.fetchGroups(), store.fetchWorkspaces()]);
  const { default: SessionOpenHome } = await import("../../../ui/components/SessionOpenHome.vue");
  const wrapper = mount(SessionOpenHome, { global: { provide: { modalTitle: ref(""), pushView: vi.fn() } } });
  await flushPromises();
  return wrapper;
}


const sectionTitles = (wrapper) => wrapper.findAll(".open-session-content > .settings-category-head .settings-category-title").map((t) => t.text());

describe("SessionOpenHome: タブ無しのカテゴリセクション", () => {
  beforeEach(() => {
    const responses = {
      "/groups": [],
      "/workspaces": [{ name: "alpha", path: "/alpha" }, { name: "empty", path: "/empty" }],
      "/common/jobs": { deploy: { label: "Deploy", command: "echo deploy", default: true } },
      "/jobs/workspaces": {
        alpha: {
          build: { label: "Build", command: "make" },
          shared: { label: "Shared", command: "echo", common: true },
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, status: 200, json: async () => responses[url] ?? [] })));
    localStorage.clear();
  });

  it("タブは無く、Workspace / Sessions / Job のセクションを順に1つのリストへ並べる", async () => {
    const wrapper = await mountSessionOpenHome();
    expect(wrapper.findAll("[role=tab]")).toHaveLength(0);
    expect(sectionTitles(wrapper)).toEqual(["Workspace", "Sessions", "Job"]);
  });

  it("Workspace セクションにワークスペース一覧と Add workspace ボタンを出す", async () => {
    const wrapper = await mountSessionOpenHome();
    expect(wrapper.find(".terminal-ws-list").exists()).toBe(true);
    expect(wrapper.find('[aria-label="Add workspace"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Add group"]').exists()).toBe(false);
  });

  it("Sessions セクションに New terminal ボタンを出す", async () => {
    const wrapper = await mountSessionOpenHome();
    expect(wrapper.findAll('[aria-label="New terminal"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("No detached sessions");
  });

  it("Job セクションに Add job ボタンと、Global・ワークスペース固有のジョブを出す", async () => {
    const wrapper = await mountSessionOpenHome();
    await flushPromises();
    const jobs = wrapper.find(".session-open-jobs");
    expect(wrapper.findAll('[aria-label="Add job"]')).toHaveLength(1);
    expect(jobs.findAll(".ws-group-title").map((h) => h.text())).toEqual(["Global", "alpha"]);
    expect(jobs.find(".ws-group-header .mdi-earth").exists()).toBe(true);
    expect(jobs.findAll(".job-default-badge").map((b) => b.text())).toEqual(["default"]);
    expect(jobs.text()).not.toContain("empty");
    expect(jobs.findAll(".job-item-label").map((l) => l.text())).toEqual(["Deploy", "Build"]);
    expect(jobs.findAll('[aria-label="Edit"]')).toHaveLength(2);
    expect(jobs.findAll('[aria-label^="Run "]').map((b) => b.attributes("aria-label"))).toEqual(["Run Build"]);
  });

  it("セクション見出しをタップすると中身を開閉し、状態を localStorage に保存する", async () => {
    const wrapper = await mountSessionOpenHome();
    const head = wrapper.findAll(".open-session-section-toggle").find((h) => h.text() === "Workspace");
    const body = () => wrapper.find(".terminal-ws-list").element.parentElement;
    expect(head.attributes("aria-expanded")).toBe("true");
    expect(body().style.display).not.toBe("none");

    await head.trigger("click");
    expect(head.attributes("aria-expanded")).toBe("false");
    expect(body().style.display).toBe("none");
    expect(JSON.parse(localStorage.getItem("any_console_collapsed_workspace_groups"))).toContain("section:workspace");

    await head.trigger("click");
    expect(head.attributes("aria-expanded")).toBe("true");
    expect(body().style.display).not.toBe("none");
  });

  it("Job セクションのワークスペース見出しをタップすると、そのジョブ行を開閉する", async () => {
    const wrapper = await mountSessionOpenHome();
    await flushPromises();
    const jobs = wrapper.find(".session-open-jobs");
    const toggle = jobs.findAll(".ws-group-toggle").find((t) => t.text() === "alpha");
    const buildRow = () => jobs.findAll(".job-item-row").find((r) => r.text().includes("Build"));
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(buildRow().element.style.display).not.toBe("none");

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(buildRow().element.style.display).toBe("none");
    expect(JSON.parse(localStorage.getItem("any_console_collapsed_workspace_groups"))).toContain("job:alpha");
  });
});
