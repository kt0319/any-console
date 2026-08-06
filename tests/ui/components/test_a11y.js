// @vitest-environment happy-dom
// @ts-check
/**
 * アクセシビリティ自動検査（axe-core）。
 *
 * docs/A11Y_AUDIT.md で手動監査・修正したコンポーネントを対象に、
 * 構造的な a11y 違反（ARIA・ロール・アクセシブルネーム等）が
 * 再混入しないことを CI で継続的に担保する。
 *
 * 色コントラスト・実機 SR 検証は対象外（axe-helper.js のコメント参照）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import ConfirmDialog from "../../../ui/components/ConfirmDialog.vue";
import PromptDialog from "../../../ui/components/PromptDialog.vue";
import GitActionBtn from "../../../ui/components/GitActionBtn.vue";
import AppToast from "../../../ui/components/AppToast.vue";
import FileItem from "../../../ui/components/FileItem.vue";
import SplitModeSelector from "../../../ui/components/SplitModeSelector.vue";
import WorkspaceGroupDialog from "../../../ui/components/WorkspaceGroupDialog.vue";
import UrlActionDialog from "../../../ui/components/UrlActionDialog.vue";
import TerminalSplitDropZones from "../../../ui/components/TerminalSplitDropZones.vue";
import SplitEmptyPane from "../../../ui/components/SplitEmptyPane.vue";
import AuthConfig from "../../../ui/components/AuthConfig.vue";
import InfoPillConfig from "../../../ui/components/InfoPillConfig.vue";
import InfoPillRow from "../../../ui/components/InfoPillRow.vue";
import PillPeek from "../../../ui/components/PillPeek.vue";
import FileBrowser from "../../../ui/components/FileBrowser.vue";
import { createPinia, setActivePinia } from "pinia";
import { useConfirm } from "../../../ui/composables/useConfirm.js";
import { usePrompt } from "../../../ui/composables/usePrompt.js";
import { useWorkspaceStore } from "../../../ui/stores/workspace.js";
import { useAuthStore } from "../../../ui/stores/auth.js";
import { emit } from "../../../ui/app-bridge.js";
import { expectNoA11yViolations } from "./axe-helper.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a11y: ConfirmDialog", () => {
  it("確認ダイアログに a11y 違反が無い", async () => {
    const wrapper = mount(ConfirmDialog, { attachTo: document.body });
    const { confirm, onCancel } = useConfirm();
    confirm("Delete file \"foo.txt\"? This cannot be undone.");
    await Promise.resolve();
    await expectNoA11yViolations(wrapper.find(".confirm-dialog").element);
    onCancel();
    wrapper.unmount();
  });
});

describe("a11y: PromptDialog", () => {
  it("入力ダイアログに a11y 違反が無い", async () => {
    const wrapper = mount(PromptDialog, { attachTo: document.body });
    const { prompt } = usePrompt();
    prompt({ title: "Rename", message: "New name", initialValue: "old.txt" });
    await Promise.resolve();
    await expectNoA11yViolations(wrapper.find(".prompt-dialog").element);
    wrapper.unmount();
  });
});

describe("a11y: GitActionBtn", () => {
  it("アイコンボタンにアクセシブルネームがある", async () => {
    const wrapper = mount(GitActionBtn, {
      props: { icon: "pull", title: "Pull" },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});

describe("a11y: AppToast", () => {
  it("各タイプのトーストに a11y 違反が無い", async () => {
    const wrapper = mount(AppToast, { attachTo: document.body });
    wrapper.vm.show("Error message", "error");
    wrapper.vm.show("Success message", "success");
    wrapper.vm.show("Info message", "info");
    await nextTick();
    // Teleport to="body" のため body 全体を検査する
    await expectNoA11yViolations(document.body);
    wrapper.unmount();
  });
});

describe("a11y: FileItem", () => {
  it("ファイル行に a11y 違反が無い", async () => {
    const wrapper = mount(FileItem, {
      props: { label: "README.md", sizeText: "12 KB", mtimeText: "2h ago" },
      attachTo: document.body,
    });
    // FileItem のルートは <li>。<ul> への内包は親 (FileBrowser) の責務であり
    // 単体マウントでは構造が成立しないため list/listitem ルールは除外する。
    await expectNoA11yViolations(wrapper.element, {
      rules: { list: { enabled: false }, listitem: { enabled: false } },
    });
    wrapper.unmount();
  });
});


describe("a11y: WorkspaceGroupDialog", () => {
  it("グループ名入力ダイアログに a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(WorkspaceGroupDialog, { attachTo: document.body });
    wrapper.vm.openAdd();
    await nextTick();
    await expectNoA11yViolations(wrapper.find(".picker-group-dialog").element);
    wrapper.unmount();
  });

  it("リネームモードのダイアログに a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(WorkspaceGroupDialog, { attachTo: document.body });
    wrapper.vm.openRename({ id: "g1", name: "Tools" });
    await nextTick();
    await expectNoA11yViolations(wrapper.find(".picker-group-dialog").element);
    wrapper.unmount();
  });
});

describe("a11y: UrlActionDialog", () => {
  it("URL アクションダイアログに a11y 違反が無い", async () => {
    const wrapper = mount(UrlActionDialog, { attachTo: document.body });
    emit("terminal:url", { uri: "https://example.com/path" });
    await nextTick();
    await expectNoA11yViolations(wrapper.find(".url-action-dialog").element);
    wrapper.unmount();
  });
});

describe("a11y: SplitModeSelector", () => {
  it("分割モード選択に a11y 違反が無い", async () => {
    const wrapper = mount(SplitModeSelector, {
      props: { currentMode: "normal", tabCount: 2 },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});

describe("a11y: TerminalSplitDropZones", () => {
  it("分割ドロップゾーンに a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(TerminalSplitDropZones, { attachTo: document.body });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});

describe("a11y: SplitEmptyPane", () => {
  it("空きペイン（タブ選択+分割パターン選択+Add pane+Remove pane）に a11y 違反が無い", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useLayoutStore } = await import("../../../ui/stores/layout.js");
    const layoutStore = useLayoutStore();
    layoutStore.splitWithDrop(1, "left", []);
    layoutStore.splitPaneTabIds = [1, "empty:1"];
    const wrapper = mount(SplitEmptyPane, {
      props: { paneIndex: 1 },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});

describe("a11y: AuthConfig (API Tokens section)", () => {
  function jsonResponse(data) {
    return Promise.resolve({ ok: true, status: 200, json: async () => data });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("トークン一覧・作成直後の raw トークン表示に a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    let created = false;
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const method = opts.method || "GET";
      if (url === "/api-tokens" && method === "GET") {
        return jsonResponse(created ? [{ id: "tok_1", name: "ci", scope: "dispatch", last_used: null }] : []);
      }
      if (url === "/api-tokens" && method === "POST") {
        created = true;
        return jsonResponse({ id: "tok_1", name: "ci", scope: "dispatch", last_used: null, token: "raw-secret" });
      }
      return jsonResponse({});
    }));

    const wrapper = mount(AuthConfig, {
      global: { provide: { modalTitle: ref("") } },
      attachTo: document.body,
    });
    await flushPromises();
    await expectNoA11yViolations(wrapper.element);

    // Create 直後（raw トークン表示 + Copy ボタン）も検査する。
    await wrapper.find('input[placeholder^="Token name"]').setValue("ci");
    await wrapper.findAll("button").find((b) => b.text() === "Create").trigger("click");
    await flushPromises();
    await expectNoA11yViolations(wrapper.element);

    wrapper.unmount();
  });
});

describe("a11y: InfoPillConfig", () => {
  function jsonResponse(data) {
    return Promise.resolve({ ok: true, status: 200, json: async () => data });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Info Pills 設定画面（Loading / 読み込み後）に a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({})));

    const wrapper = mount(InfoPillConfig, {
      global: { provide: { modalTitle: ref("") } },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);

    await flushPromises();
    await expectNoA11yViolations(wrapper.element);

    wrapper.unmount();
  });
});

describe("a11y: InfoPillRow", () => {
  it("全ピル表示状態でアクセシブルネーム等に a11y 違反が無い", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(InfoPillRow, {
      props: {
        tab: { id: "t1", sessionId: "s1", workspace: "ws1", label: "ws1" },
        maxWidth: 400,
        isGitRepo: true,
        isDirty: true,
        ahead: 2,
        behind: 1,
        hasPr: true,
        hasAction: true,
        hasDevServer: true,
        dispatchCount: 2,
        actionStatusClass: "action-status-running",
        actionStatusIcon: "mdi-progress-clock",
        tooltips: {
          files: "ws1  ·  Browse files",
          history: "History: feat: something",
          changes: "Changes: 1F +2 -3",
          branch: "Branches: main",
          prs: "GitHub PR #1: feat",
          actions: "GitHub Actions: CI (in_progress)",
          devserver: "Dev Server: http://localhost:23000",
          dispatch: "Dispatch: 2 pending",
        },
      },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});

describe("a11y: PillPeek", () => {
  it("peekピル（role=button）に a11y 違反が無い", async () => {
    const wrapper = mount(PillPeek, {
      props: {
        peekingKey: "history",
        iconClass: "mdi-history",
        text: "feat: something",
        tab: { id: "t1" },
        maxWidth: 300,
      },
      attachTo: document.body,
    });
    await expectNoA11yViolations(wrapper.element);
    wrapper.unmount();
  });
});

describe("a11y: FileBrowser (Loading / Error メッセージ)", () => {
  function jsonResponse(data) {
    return { ok: true, json: async () => data };
  }

  it("読み込み中は role=status、エラー時は role=alert を持つ", async () => {
    setActivePinia(createPinia());
    useWorkspaceStore().selectedWorkspace = "ws1";
    const auth = useAuthStore();
    let resolveList;
    auth.apiFetch = vi.fn((url) => {
      if (String(url).includes("/files?path=")) {
        return new Promise((resolve) => { resolveList = resolve; });
      }
      return Promise.resolve(jsonResponse({}));
    });

    const wrapper = mount(FileBrowser, { attachTo: document.body });

    // ライブリージョンは常時マウントしておく必要がある。v-if で挿入と同時に
    // テキストを入れると、スクリーンリーダーが変化を検知できない場合があるため
    // （マウント直後は空のまま存在していることを確認する）。
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.find('[role="status"]').text()).toBe("");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);

    wrapper.vm.navigateToPath("subdir");
    await nextTick();

    const loadingEl = wrapper.find('[role="status"]');
    expect(loadingEl.exists()).toBe(true);
    expect(loadingEl.attributes("aria-live")).toBe("polite");
    await expectNoA11yViolations(loadingEl.element);

    resolveList({ ok: false, json: async () => ({ detail: "boom" }) });
    await flushPromises();

    const errorEl = wrapper.find('[role="alert"]');
    expect(errorEl.exists()).toBe(true);
    await expectNoA11yViolations(errorEl.element);

    wrapper.unmount();
  });
});
