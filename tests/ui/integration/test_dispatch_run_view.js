// @vitest-environment happy-dom
// @ts-check
/** 統合テスト: DispatchRunView */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { emit } from "../../../ui/app-bridge.ts";
import DispatchRunView from "../../../ui/components/DispatchRunView.vue";
import { useWorkspaceStore } from "../../../ui/stores/workspace.ts";
import { applyDispatchQueue } from "../../../ui/composables/useDispatchQueue.ts";

describe("DispatchRunView: dedup_key による置き換えの検知", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    applyDispatchQueue([]);
  });

  it("同じ id のまま payload が置き換わったら back を emit する（古い内容のまま実行されないように）", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "first", branch: "main", retry_count: 1 } },
    ]);

    const wrapper = mount(DispatchRunView, { props: { itemId: "d1" } });
    await flushPromises();
    expect(wrapper.emitted("back")).toBeUndefined();

    // dispatch_id は変えず内容だけ置き換わるケース（同一 dedup_key の連続失敗）。
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "second", branch: "feature/x", retry_count: 2 } },
    ]);
    await flushPromises();

    expect(wrapper.emitted("back")).toBeTruthy();
  });

  it("retry_count が変わらない再描画では back を emit しない", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "first", branch: "main", retry_count: 1 } },
    ]);

    const wrapper = mount(DispatchRunView, { props: { itemId: "d1" } });
    await flushPromises();

    // 同じスナップショットの再配信（内容変化なし）。
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "first", branch: "main", retry_count: 1 } },
    ]);
    await flushPromises();

    expect(wrapper.emitted("back")).toBeUndefined();
  });
});

// ── DispatchRunView: dirty workspace のブランチ切替ブロック ──────────────────

function mountDispatchRunView(itemId = "d1") {
  return mount(DispatchRunView, { props: { itemId } });
}

function findRunButton(wrapper) {
  return wrapper.findAll("button").find((b) => b.text().includes("Run"));
}

// DispatchRunView は Session/Job/Branch 一覧の取得完了を待ってから Run を有効化する
// （infoLoading）。CIの実fetchは接続エラーになるまで時間がかかり flushPromises() 1回
// では解決しきれないため、branches を含む全リクエストを即時解決するモックに差し替える。
function stubDispatchRunViewFetch(branches = [{ name: "main" }]) {
  const originalFetch = global.fetch;
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("/branches")) {
      return { ok: true, json: async () => branches };
    }
    return { ok: true, json: async () => ({}) };
  });
  return () => { global.fetch = originalFetch; };
}

describe("DispatchRunView: dirty workspace でのブランチ切替ブロック", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    applyDispatchQueue([]);
  });

  it("ブランチを切り替える dispatch + dirty workspace は Run を disable し理由を表示する", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/x", create_branch: true, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 2 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    const runBtn = findRunButton(wrapper);
    expect(runBtn.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("uncommitted changes (2 files)");
    wrapper.unmount();
  });

  it("ファイル数が1件なら単数形で表示する", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/x", create_branch: true, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 1 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    expect(wrapper.text()).toContain("uncommitted changes (1 file)");
    wrapper.unmount();
  });

  it("ブランチが現在ブランチと同じならブロックしない", async () => {
    const restoreFetch = stubDispatchRunViewFetch();
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", branch: "main", create_branch: true, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 3 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    } finally {
      restoreFetch();
    }
  });

  it("Create branch オフなら既存ブランチへの切替 + dirty でもブロックしない", async () => {
    const restoreFetch = stubDispatchRunViewFetch([{ name: "main" }, { name: "feature/existing" }]);
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/existing", create_branch: false, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 4 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).not.toContain("uncommitted changes");
      wrapper.unmount();
    } finally {
      restoreFetch();
    }
  });

  it("Run 成功時、実行中にコンポーネントが破棄されても afterRun で親へ通知する", async () => {
    const originalFetch = global.fetch;
    let wrapper;
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/decision") && init?.method === "POST") {
        // Runで新規タブが作られアクティブタブが切り替わり、WorkspaceDetailごと破棄される状況
        wrapper.unmount();
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];
      const afterRun = vi.fn();

      wrapper = mount(DispatchRunView, { props: { itemId: "d1", afterRun } });
      await flushPromises();
      await findRunButton(wrapper).trigger("click");
      await flushPromises();

      expect(afterRun).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Create worktree を選ぶと Session は + New session に切り替わり、選択できなくなる", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/branches")) return { ok: true, json: async () => [{ name: "main" }] };
      if (String(url).includes("/terminal/sessions")) {
        return { ok: true, json: async () => [{ session_id: "s1", workspace: "ws1", job_name: "terminal" }] };
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([{ id: "d1", request: { workspace: "ws1", text: "run", retry_count: 1 } }]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mount(DispatchRunView, { props: { itemId: "d1", preferredSessionId: "s1" } });
      await flushPromises();
      const sessionSelect = () => wrapper.findAll("select")[0];
      expect(sessionSelect().element.value).toBe("s1");
      expect(sessionSelect().attributes("disabled")).toBeUndefined();

      await wrapper.find('input[type="radio"][value="worktree"]').setValue(true);
      await flushPromises();
      expect(sessionSelect().element.value).toBe("__new_session__");
      expect(sessionSelect().attributes("disabled")).toBeDefined();

      await wrapper.find('input[type="radio"][value=""]').setValue(true);
      await flushPromises();
      expect(sessionSelect().attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Change branch の初期値が実在しないブランチなら Run を disable してエラーを表示する", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/branches")) {
        return { ok: true, json: async () => [{ name: "main" }, { name: "feature/y" }] };
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/deleted", create_branch: false, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain('Branch "feature/deleted" does not exist');
      wrapper.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Change branch の初期値が実在するブランチならブロックしない", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/branches")) {
        return { ok: true, json: async () => [{ name: "main" }, { name: "feature/existing" }] };
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/existing", create_branch: false, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).not.toContain("does not exist");
      wrapper.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Create branchで入力した新規ブランチ名はChange branchのBranch selectには影響しない", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/branches")) {
        return { ok: true, json: async () => [{ name: "main" }, { name: "feature/existing" }] };
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", create_branch: false, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const radios = wrapper.findAll("input[type=radio]");
      await radios[1].setValue(); // Create branch
      await wrapper.find("input[type=text]").setValue("my-new-feature"); // New branch name
      await radios[0].setValue(); // Change branch へ戻す
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).not.toContain("does not exist");
      wrapper.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Create branchで入力した新規ブランチ名はChange branchを経由して戻っても消えない", async () => {
    applyDispatchQueue([
      { id: "d1", request: { workspace: "ws1", text: "run", create_branch: false, retry_count: 1 } },
    ]);
    useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

    const wrapper = mountDispatchRunView();
    await flushPromises();

    const radios = wrapper.findAll("input[type=radio]");
    await radios[1].setValue(); // Create branch
    await wrapper.find("input[type=text]").setValue("my-new-feature");
    await radios[0].setValue(); // Change branch へ戻す
    await flushPromises();
    await radios[1].setValue(); // Create branch へ再度切替
    await flushPromises();

    expect(wrapper.find("input[type=text]").element.value).toBe("my-new-feature");
    wrapper.unmount();
  });

  it("ブランチ未指定（現在ブランチのまま）ならdirtyでもブロックしない", async () => {
    const restoreFetch = stubDispatchRunViewFetch();
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 5 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    } finally {
      restoreFetch();
    }
  });

  it("workspace がクリーン（changed_files: 0）ならブロックしない", async () => {
    const restoreFetch = stubDispatchRunViewFetch([{ name: "main" }, { name: "feature/y" }]);
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", branch: "feature/y", create_branch: true, retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    } finally {
      restoreFetch();
    }
  });

  // 再発防止: branch一覧の取得APIが失敗（error状態）してもRunが永久disabledのまま
  // 残らないこと（AsyncStateのerrorはisAsyncPendingでfalseになる必要がある）。
  it("branch一覧の取得が失敗してもRunを永久disableにしない", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/branches")) {
        return { ok: false, json: async () => ({ detail: "boom" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    try {
      applyDispatchQueue([
        { id: "d1", request: { workspace: "ws1", text: "run", retry_count: 1 } },
      ]);
      useWorkspaceStore().allWorkspaces = [{ name: "ws1", branch: "main", changed_files: 0 }];

      const wrapper = mountDispatchRunView();
      await flushPromises();

      const runBtn = findRunButton(wrapper);
      expect(runBtn.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
