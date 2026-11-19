// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: コマンドパレットで一致するコマンドが無いとき、入力そのものを引数にした操作を提案する */
import { defineComponent, h } from "vue";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { on } from "../../../ui/app-bridge.ts";
import { useTerminalStore } from "../../../ui/stores/terminal.ts";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";
import { useCommandPalette } from "../../../ui/composables/useCommandPalette.ts";
import SessionListPanel from "../../../ui/components/SessionListPanel.vue";
import CommandPaletteInput from "../../../ui/components/CommandPaletteInput.vue";

const createBranchIn = vi.fn(async () => true);
const createWorktreeIn = vi.fn(async () => true);
vi.mock("../../../ui/composables/useWorkspaceBranchCreate.ts", () => ({
  useWorkspaceBranchCreate: () => ({ createBranchIn, createWorktreeIn }),
}));

const dispatchTextToTab = vi.fn(() => true);
vi.mock("../../../ui/utils/terminal-dispatch.ts", () => ({
  dispatchTextToTab: (...args) => dispatchTextToTab(...args),
  dispatchKeyToTab: vi.fn(),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("../../../ui/composables/useToast.ts", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}));

const SessionListViewStub = { template: '<div class="session-list-stub"></div>' };
const Harness = defineComponent({
  render: () => h("div", [h(CommandPaletteInput), h(SessionListPanel)]),
});

function seed({ isGit = true, withTab = true } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useWorkspaceStore().allWorkspaces = [/** @type {any} */ ({ name: "proj", is_git_repo: isGit })];
  if (withTab) {
    const terminalStore = useTerminalStore();
    terminalStore.openTabs.push(/** @type {any} */ ({ id: 1, workspace: "proj", sessionId: "sess-1", label: "", jobName: null, jobLabel: null }));
    terminalStore.activeTabId = 1;
  }
  return pinia;
}

function mountPanel(pinia) {
  return mount(Harness, {
    attachTo: document.body,
    global: { plugins: [pinia], stubs: { SessionListView: SessionListViewStub } },
  });
}

function labelsOf(wrapper) {
  return wrapper.findAll(".command-palette-item-label").map((l) => l.text());
}

describe("コマンドパレットの入力引数つき操作", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ recent_jobs: [] }) })));
  });

  afterEach(() => {
    useCommandPalette().setQuery("");
    vi.unstubAllGlobals();
  });

  it("ブランチ名らしい入力ではブランチ作成を先頭に出し、Enter でアクティブなワークスペースに作る", async () => {
    const wrapper = mountPanel(seed());
    const input = wrapper.find("input");
    await input.setValue("feature/login");
    expect(labelsOf(wrapper)).toEqual([
      'Create branch "feature/login" in proj',
      'Create worktree "feature/login" in proj',
      'Send to terminal "feature/login"',
      'Open path "feature/login"',
    ]);

    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(createBranchIn).toHaveBeenCalledWith("proj", "feature/login");
    expect(toastSuccess).toHaveBeenCalledWith('Created branch "feature/login"');
    wrapper.unmount();
  });

  it("作成先のワークスペースにブランチ名が分かるときはブランチ名も表示する", async () => {
    const pinia = seed();
    useWorkspaceStore().allWorkspaces = [/** @type {any} */ ({ name: "proj", is_git_repo: true, branch: "main" })];
    const wrapper = mountPanel(pinia);
    await wrapper.find("input").setValue("feature-x");
    expect(labelsOf(wrapper)[0]).toBe('Create branch "feature-x" in proj | main');
    wrapper.unmount();
  });

  it("worktree 作成を選ぶとそのワークスペースで worktree を作る", async () => {
    const wrapper = mountPanel(seed());
    await wrapper.find("input").setValue("fix-bug");
    await wrapper.findAll("[role=option]")[1].trigger("click");
    expect(createWorktreeIn).toHaveBeenCalledWith("proj", "fix-bug");
    expect(createBranchIn).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("パスらしい入力ではパスを開く操作を先頭に出し、セッションのパスとして開く", async () => {
    const opened = vi.fn();
    const off = on("terminal:path", opened);
    const wrapper = mountPanel(seed());
    const input = wrapper.find("input");
    await input.setValue("src/main.ts");
    expect(labelsOf(wrapper)[0]).toBe('Open path "src/main.ts"');

    await input.trigger("keydown", { key: "Enter" });
    expect(opened).toHaveBeenCalledWith({ path: "src/main.ts", sessionId: "sess-1" });
    off();
    wrapper.unmount();
  });

  it("空白を含む入力はブランチ名にならず、ターミナルへの送信とパスを開く操作だけを出す", async () => {
    const wrapper = mountPanel(seed());
    await wrapper.find("input").setValue("git log --oneline");
    expect(labelsOf(wrapper)).toEqual([
      'Send to terminal "git log --oneline"',
      'Open path "git log --oneline"',
    ]);
    wrapper.unmount();
  });

  it("ターミナルへ送信すると入力文字列をそのまま送る（実行はしない）", async () => {
    const wrapper = mountPanel(seed());
    await wrapper.find("input").setValue("git status");
    await wrapper.findAll("[role=option]")[0].trigger("click");
    expect(dispatchTextToTab).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess-1" }), "git status");
    expect(toastError).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("送信に失敗したらエラートーストを出す", async () => {
    dispatchTextToTab.mockReturnValueOnce(false);
    const wrapper = mountPanel(seed());
    await wrapper.find("input").setValue("git status");
    await wrapper.findAll("[role=option]")[0].trigger("click");
    expect(toastError).toHaveBeenCalledWith("Terminal is not connected");
    wrapper.unmount();
  });

  it("一致するコマンドがあるときも、その後ろに提案を出す（先頭は一致したコマンド）", async () => {
    const wrapper = mountPanel(seed());
    const input = wrapper.find("input");
    await input.setValue("settings");
    const labels = labelsOf(wrapper);
    expect(labels[0]).toBe("Settings");
    expect(labels.slice(-4)).toEqual([
      'Create branch "settings" in proj',
      'Create worktree "settings" in proj',
      'Send to terminal "settings"',
      'Open path "settings"',
    ]);

    const opened = vi.fn();
    const off = on("settings:open", opened);
    await input.trigger("keydown", { key: "Enter" });
    expect(opened).toHaveBeenCalled();
    expect(createBranchIn).not.toHaveBeenCalled();
    off();
    wrapper.unmount();
  });

  it("git でないワークスペースではブランチ作成を出さない", async () => {
    const wrapper = mountPanel(seed({ isGit: false }));
    await wrapper.find("input").setValue("feature-x");
    expect(labelsOf(wrapper)).toEqual(['Send to terminal "feature-x"', 'Open path "feature-x"']);
    wrapper.unmount();
  });

  it("ブランチ名として使えない入力ではブランチ作成を出さない", async () => {
    const wrapper = mountPanel(seed());
    await wrapper.find("input").setValue("a..b");
    expect(labelsOf(wrapper).some((l) => l.startsWith("Create"))).toBe(false);
    wrapper.unmount();
  });

  it("アクティブなタブが無ければ提案を出さず空表示になる", async () => {
    const wrapper = mountPanel(seed({ withTab: false }));
    await wrapper.find("input").setValue("feature-x");
    expect(wrapper.findAll("[role=option]")).toHaveLength(0);
    expect(wrapper.find("[role=status]").text()).toBe("No matches");
    wrapper.unmount();
  });
});
