// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

async function mountWithLaunchLog(commonJobs) {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal("fetch", vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({
      "/groups": [],
      "/workspaces": [{ name: "alpha", path: "/alpha" }],
      "/common/jobs": commonJobs,
      "/jobs/workspaces": { alpha: {} },
    })[url] ?? [],
  })));
  const { useWorkspaceStore } = await import("../../../ui/stores/workspace.ts");
  await Promise.all([useWorkspaceStore().fetchGroups(), useWorkspaceStore().fetchWorkspaces()]);
  const bridge = await import("../../../ui/app-bridge.ts");
  const launches = [];
  bridge.on("terminal:launch", (detail) => launches.push(detail));
  const { default: SessionOpenHome } = await import("../../../ui/components/SessionOpenHome.vue");
  const wrapper = mount(SessionOpenHome, { global: { provide: { modalTitle: ref(""), pushView: vi.fn() } } });
  await flushPromises();
  return { wrapper, launches };
}

const tapAlpha = (wrapper) => wrapper.find(".ws-list-header-label").trigger("click");

describe("SessionOpenHome: デフォルトジョブ", () => {
  beforeEach(() => localStorage.clear());

  it("デフォルトジョブがあれば、ワークスペースのタップでそのワークスペースにて直接起動する", async () => {
    const { wrapper, launches } = await mountWithLaunchLog({
      deploy: { label: "Deploy", command: "echo deploy", confirm: false, default: true },
      other: { label: "Other", command: "echo other", confirm: false },
    });
    await tapAlpha(wrapper);
    await flushPromises();
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ workspace: "alpha", jobName: "deploy", initialCommand: "echo deploy" });
    expect(wrapper.find(".ws-job-dialog").exists()).toBe(false);
  });

  it("デフォルトジョブが無ければ、ワークスペースのタップでそのワークスペースの素のターミナルを開く", async () => {
    const { wrapper, launches } = await mountWithLaunchLog({
      deploy: { label: "Deploy", command: "echo deploy", confirm: false },
    });
    await tapAlpha(wrapper);
    await flushPromises();
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ workspace: "alpha" });
    expect(launches[0].initialCommand).toBeUndefined();
    expect(wrapper.find(".ws-job-dialog").exists()).toBe(false);
  });

  it("Job の Global に Terminal を出し、デフォルトジョブが無いときだけ default バッジを付ける", async () => {
    const none = await mountWithLaunchLog({ deploy: { label: "Deploy", command: "echo deploy", confirm: false } });
    const badges = (w) => w.findAll(".session-open-jobs .job-item-row").filter((r) => r.find(".job-default-badge").exists()).map((r) => r.find(".job-item-label").text());
    expect(none.wrapper.findAll(".session-open-jobs .job-item-label")[0].text()).toBe("Terminal");
    expect(badges(none.wrapper)).toEqual(["Terminal"]);
    const some = await mountWithLaunchLog({ deploy: { label: "Deploy", command: "echo deploy", confirm: false, default: true } });
    expect(badges(some.wrapper)).toEqual(["Deploy"]);
  });

  it("Select job ボタンはデフォルトジョブがあってもダイアログを開く", async () => {
    const { wrapper, launches } = await mountWithLaunchLog({
      deploy: { label: "Deploy", command: "echo deploy", confirm: false, default: true },
    });
    await wrapper.find('[aria-label="Select job"]').trigger("click");
    await flushPromises();
    expect(launches).toHaveLength(0);
    expect(wrapper.find(".ws-job-dialog").exists()).toBe(true);
  });
});
