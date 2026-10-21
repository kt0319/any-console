// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, computed, defineComponent, h, nextTick } from "vue";
import {
  trailingItemsSignature,
  findChangedTrailingItems,
  buildTrailingPeekItems,
  buildPeekText,
  buildPeekSignature,
} from "../../ui/utils/pill-peek.ts";
import { usePillPeek } from "../../ui/composables/usePillPeek.ts";
import { emit } from "../../ui/app-bridge.ts";
import { markStreamLost, markStreamRecovered, resetPeekQuietForTest } from "../../ui/utils/peek-quiet.ts";
import { PILL_PEEK_DURATION_MS, PILL_PEEK_RESYNC_QUIET_MS } from "../../ui/utils/constants.ts";

const ALL_ON = {
  files: true,
  changes: true,
  branch: true,
  prs: true,
  actions: true,
  devserver: true,
  docker: true,
  issues: true,
  add: true,
  dispatch: true,
};

describe("trailingItemsSignature / findChangedTrailingItems", () => {
  it("シグネチャはkey→textのMapを作る", () => {
    const sig = trailingItemsSignature([{ key: "a", text: "1" }, { key: "b", text: "2" }]);
    expect(sig.get("a")).toBe("1");
    expect(sig.get("b")).toBe("2");
  });

  it("空配列/未指定でも空のMapを返す", () => {
    expect(trailingItemsSignature([]).size).toBe(0);
    expect(trailingItemsSignature(undefined).size).toBe(0);
  });

  it("text が変わった項目・新規追加された項目を返す", () => {
    const prev = trailingItemsSignature([{ key: "a", text: "1" }]);
    const changed = findChangedTrailingItems(
      [{ key: "a", text: "2" }, { key: "b", text: "new" }],
      prev,
    );
    expect(changed).toEqual([{ key: "a", text: "2" }, { key: "b", text: "new" }]);
  });

  it("変化が無ければ空配列", () => {
    const prev = trailingItemsSignature([{ key: "a", text: "1" }]);
    expect(findChangedTrailingItems([{ key: "a", text: "1" }], prev)).toEqual([]);
  });

  it("複数変化していれば items の並び順で全て返す", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [
      { key: "branch", text: "feature/x" },
      { key: "push", text: "2" },
    ];
    expect(findChangedTrailingItems(items, prev)).toEqual(items);
  });

  it("項目が消えた場合は残っている項目に変化が無ければ空配列", () => {
    const prev = trailingItemsSignature([
      { key: "branch", text: "main" },
      { key: "push", text: "1" },
    ]);
    const items = [{ key: "branch", text: "main" }];
    expect(findChangedTrailingItems(items, prev)).toEqual([]);
  });
});

describe("buildTrailingPeekItems", () => {
  it("workspaceは常に含まれる", () => {
    const items = buildTrailingPeekItems({ workspaceLabel: "my-ws" }, ALL_ON);
    expect(items).toEqual([{ key: "workspace", text: "my-ws" }]);
  });

  it("isGitRepoでもhasSessionでもfilesが出る", () => {
    expect(buildTrailingPeekItems({ hasSession: true }, ALL_ON).some((i) => i.key === "files")).toBe(true);
    expect(buildTrailingPeekItems({ isGitRepo: true }, ALL_ON).some((i) => i.key === "files")).toBe(true);
    expect(buildTrailingPeekItems({}, ALL_ON).some((i) => i.key === "files")).toBe(false);
  });

  it("changesはisGitRepo && isDirtyの時だけ出て、text は F/+/- を含む", () => {
    const items = buildTrailingPeekItems(
      { isGitRepo: true, isDirty: true, changedFiles: 3, insertions: 10, deletions: 2 },
      ALL_ON,
    );
    expect(items.find((i) => i.key === "changes")).toEqual({ key: "changes", text: "3F +10 -2" });
    expect(buildTrailingPeekItems({ isGitRepo: true, isDirty: false }, ALL_ON).some((i) => i.key === "changes")).toBe(false);
  });

  it("branchはahead/behindを含む固定形式", () => {
    const items = buildTrailingPeekItems({ isGitRepo: true, branch: "main", ahead: 1, behind: 2 }, ALL_ON);
    expect(items.find((i) => i.key === "branch")).toEqual({ key: "branch", text: "main:1:2" });
  });

  it("prs/actions/devserver/dockerはそれぞれの値が無ければ出ない", () => {
    const empty = buildTrailingPeekItems({}, ALL_ON);
    expect(empty.some((i) => i.key === "prs")).toBe(false);
    expect(empty.some((i) => i.key === "actions")).toBe(false);
    expect(empty.some((i) => i.key === "devserver")).toBe(false);
    expect(empty.some((i) => i.key === "docker")).toBe(false);

    const filled = buildTrailingPeekItems(
      {
        branchPR: { number: 12, title: "Fix bug" },
        branchAction: { id: 9, status: "completed", conclusion: "success" },
        devServerEntry: { proxy_port: 3001 },
        dockerContainers: [{ name: "web-1", state: "running" }, { name: "redis-1", state: "exited" }],
      },
      ALL_ON,
    );
    expect(filled.find((i) => i.key === "prs")).toEqual({ key: "prs", text: "12:Fix bug" });
    expect(filled.find((i) => i.key === "actions")).toEqual({ key: "actions", text: "9:completed:success" });
    expect(filled.find((i) => i.key === "devserver")).toEqual({ key: "devserver", text: "Server:3001" });
    // exited状態のコンテナはtextに含めない(running/restartingのみ)。
    expect(filled.find((i) => i.key === "docker")).toEqual({ key: "docker", text: "Docker:web-1" });
  });

  it("dockerはrunning/restarting以外なら出ない", () => {
    const items = buildTrailingPeekItems(
      { dockerContainers: [{ name: "redis-1", state: "exited" }] },
      ALL_ON,
    );
    expect(items.some((i) => i.key === "docker")).toBe(false);
  });

  it("dockerはrestarting単体でも出て、textに含まれる", () => {
    const items = buildTrailingPeekItems(
      { dockerContainers: [{ name: "web-1", state: "restarting" }] },
      ALL_ON,
    );
    expect(items.find((i) => i.key === "docker")).toEqual({ key: "docker", text: "Docker:web-1" });
  });

  it("issuesはopen issueが無ければ出ない", () => {
    expect(buildTrailingPeekItems({ issuesCount: 0 }, ALL_ON).some((i) => i.key === "issues")).toBe(false);
  });

  it("issuesはopen issueがあれば件数付きで出る", () => {
    const items = buildTrailingPeekItems({ issuesCount: 3 }, ALL_ON);
    expect(items.find((i) => i.key === "issues")).toEqual({ key: "issues", text: "Issues:3" });
  });

  it("addはワークスペース未紐付け・セッションありの時だけ出る", () => {
    expect(buildTrailingPeekItems({ hasWorkspace: false, hasSession: true }, ALL_ON).some((i) => i.key === "add")).toBe(true);
    expect(buildTrailingPeekItems({ hasWorkspace: true, hasSession: true }, ALL_ON).some((i) => i.key === "add")).toBe(false);
  });

  it("dispatchは1件以上ある時だけ出て、idをカンマ結合する", () => {
    const items = buildTrailingPeekItems({ dispatchItems: [{ id: "d1" }, { id: "d2" }] }, ALL_ON);
    expect(items.find((i) => i.key === "dispatch")).toEqual({ key: "dispatch", text: "d1,d2" });
  });

  it("infoPillConfigでオフにしたキーは出ない", () => {
    const cfg = { ...ALL_ON, branch: false };
    const items = buildTrailingPeekItems({ isGitRepo: true, branch: "main" }, cfg);
    expect(items.some((i) => i.key === "branch")).toBe(false);
  });
});

describe("buildPeekText", () => {
  it("キーごとに固定/派生テキストを返す", () => {
    expect(buildPeekText("files", {})).toBe("Files");
    expect(buildPeekText("prs", { branchPR: { number: 5, title: "Add feature" } })).toBe("#5 Add feature");
    expect(buildPeekText("prs", {})).toBe("");
    expect(buildPeekText("actions", { branchAction: { name: "CI", status: "completed", conclusion: "success" } })).toBe("[CI] success");
    expect(buildPeekText("devserver", { devServerEntry: { proxy_port: 3000 } })).toBe("Dev Server :3000");
    expect(buildPeekText("devserver", {})).toBe("Server");
    expect(buildPeekText("devserver-stop", {})).toBe("Dev Server Stop");
    expect(buildPeekText("job", { jobLabel: "Build" })).toBe("Build");
    expect(buildPeekText("job", {})).toBe("");
    expect(buildPeekText("docker", { dockerContainers: [{ name: "web-1", state: "running" }] })).toBe("Docker: web-1");
    expect(buildPeekText("docker", { dockerContainers: [{ name: "web-1", state: "restarting" }] })).toBe("Docker: web-1");
    expect(buildPeekText("docker", { dockerContainers: [{ name: "redis-1", state: "exited" }] })).toBe("Docker");
    expect(buildPeekText("docker", {})).toBe("Docker");
    expect(buildPeekText("issues", { issuesCount: 3 })).toBe("GitHub Issues: 3 open");
    expect(buildPeekText("issues", {})).toBe("GitHub Issues");
    expect(buildPeekText("add", {})).toBe("Add");
    expect(buildPeekText("dispatch", { dispatchTooltip: "Run pending" })).toBe("Run pending");
    expect(buildPeekText("workspace", { workspaceLabel: "my-ws" })).toBe("my-ws");
    expect(buildPeekText("unknown-key", {})).toBe("");
  });
});

describe("usePillPeek", () => {
  function mountPillPeek(opts = {}) {
    const branch = ref("main");
    const ahead = ref(opts.ahead ?? 3);
    const behind = ref(opts.behind ?? 0);
    const upstreamHead = ref(opts.upstreamHead);
    const branchPillOn = ref(true);
    const trailingPeekItems = computed(() => [
      ...(opts.filesPill ? [{ key: "files", text: "Files" }] : []),
      ...(opts.githubPills ? [{ key: "prs", text: "5:feat" }, { key: "issues", text: "Issues:2" }] : []),
      ...(opts.actionsPill ? [{ key: "actions", text: `11:${runStatus.value}:` }] : []),
      ...(branchPillOn.value ? [{ key: "branch", text: `${branch.value}:${ahead.value}:${behind.value}` }] : []),
    ]);
    const runStatus = ref("queued");
    const peekFields = computed(() => ({
      branch: branch.value, ahead: ahead.value, behind: behind.value, upstreamHead: upstreamHead.value, branchPR: { number: 5 },
      branchAction: { id: 11, name: "CI", status: runStatus.value, conclusion: "" },
    }));
    const prsByWorkspace = ref({});
    let peek;
    const Comp = defineComponent({
      setup() {
        peek = usePillPeek({
          trailingPeekItems,
          sessionId: () => "sess1",
          paneWorkspace: computed(() => ({})),
          workspaceKey: () => "ws1",
          prsByWorkspace,
          runsByWorkspace: ref({}),
          devServerEntry: computed(() => null),
          ahead,
          behind,
          peekFields,
          fetchRecentSubjects: opts.fetchRecentSubjects,
        });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    return { wrapper, peek, branch, ahead, behind, upstreamHead, branchPillOn, prsByWorkspace, runStatus };
  }

  describe("status stream 再接続時の抑制", () => {
    afterEach(() => resetPeekQuietForTest());

    it("切断中と再接続後の再同期中は値が変わってもpeekを出さない", async () => {
      const { peek, branch } = mountPillPeek();
      markStreamLost();
      branch.value = "other";
      await nextTick();
      expect(peek.peekingKey.value).toBe(null);
      markStreamRecovered();
      branch.value = "main";
      await nextTick();
      expect(peek.peekingKey.value).toBe(null);
    });

    it("再同期の静穏期間を過ぎれば通常どおりpeekを出す", async () => {
      const { peek, branch } = mountPillPeek();
      markStreamLost();
      markStreamRecovered(Date.now() - PILL_PEEK_RESYNC_QUIET_MS - 1);
      branch.value = "other";
      await nextTick();
      expect(peek.peekingKey.value).toBe("branch");
    });
  });

  it("同一ブランチでahead>0から0へ変わったらpush完了として件数を出す", async () => {
    const { peek, ahead, upstreamHead } = mountPillPeek({ upstreamHead: "aaa" });
    upstreamHead.value = "bbb";
    ahead.value = 0;
    await nextTick();
    expect(peek.peekingKey.value).toBe("branch");
    expect(peek.branchPushCount.value).toBe(3);
  });

  it("upstreamが動いてahead>0から0へ変わったらpush完了として扱う（force pushでHEADが動いても）", async () => {
    const { peek, ahead, upstreamHead } = mountPillPeek({ upstreamHead: "aaa" });
    upstreamHead.value = "bbb";
    ahead.value = 0;
    await nextTick();
    expect(peek.branchPushCount.value).toBe(3);
  });

  it("upstreamが動かないままaheadが0になった（reset等）場合はpush完了扱いにしない", async () => {
    const { peek, ahead } = mountPillPeek({ upstreamHead: "aaa" });
    ahead.value = 0;
    await nextTick();
    expect(peek.peekingKey.value).toBe("branch");
    expect(peek.branchPushCount.value).toBe(0);
    expect(peek.branchRemoteResult.value).toBeNull();
  });

  it("ブランチ切替でahead>0から0へ変わってもpush完了扱いにしない", async () => {
    const { peek, branch, ahead } = mountPillPeek();
    branch.value = "feature";
    ahead.value = 0;
    await nextTick();
    expect(peek.peekingKey.value).toBe("branch");
    expect(peek.branchPushCount.value).toBe(0);
  });
  it("session:jobBoundで自セッションのjob peekを出す", async () => {
    const { peek } = mountPillPeek();
    emit("session:jobBound", { sessionId: "sess1" });
    await nextTick();
    expect(peek.peekingKey.value).toBe("job");
  });

  it("session:workspaceBoundで自セッションのworkspace peekを出す", async () => {
    const { peek } = mountPillPeek();
    emit("session:workspaceBound", { sessionId: "sess1" });
    await nextTick();
    expect(peek.peekingKey.value).toBe("workspace");
  });

  it("先行peekの表示中に届いたjob検知も一定時間は表示する", async () => {
    vi.useFakeTimers();
    const { peek } = mountPillPeek();
    emit("session:workspaceBound", { sessionId: "sess1" });
    await vi.advanceTimersByTimeAsync(3500);
    emit("session:jobBound", { sessionId: "sess1" });
    await vi.advanceTimersByTimeAsync(600);
    expect(peek.peekingKey.value).toBe("job");
    await vi.advanceTimersByTimeAsync(3000);
    expect(peek.peekingKey.value).toBe("job");
    vi.useRealTimers();
  });

  it("files:opDoneで自ワークスペースの文言をfiles peekに出す", async () => {
    const { peek } = mountPillPeek({ filesPill: true });
    emit("files:opDone", { wsName: "ws1", text: "Deleted a.txt" });
    await nextTick();
    expect(peek.peekingKey.value).toBe("files");
    expect(peek.peekText.value).toBe("Deleted a.txt");
    expect(peek.peekSignature.value).toContain("Deleted a.txt");
  });

  it("別ワークスペース宛て・filesピルが無い時のfiles:opDoneは無視する", async () => {
    const { peek } = mountPillPeek({ filesPill: true });
    emit("files:opDone", { wsName: "other", text: "Deleted a.txt" });
    await nextTick();
    expect(peek.peekingKey.value).toBeNull();
    const { peek: noFiles } = mountPillPeek();
    emit("files:opDone", { wsName: "ws1", text: "Deleted a.txt" });
    await nextTick();
    expect(noFiles.peekingKey.value).toBeNull();
  });

  describe("サーバが確定した新着（github:activity）", () => {
    const ev = (over = {}) => ({
      kind: "comment", target: "pr", number: 5, title: "feat", author: "alice",
      createdAt: "2026-01-01T00:00:00Z", url: "u", overflow: false, ...over,
    });
    const send = (items, workspace = "ws1") => emit("github:activity", { workspace, items });

    it("現在ブランチのPRのコメント・レビューをprs peekに出す", async () => {
      const { peek } = mountPillPeek({ githubPills: true });
      send([ev(), ev({ kind: "comment" }), ev({ kind: "review" })]);
      await nextTick();
      expect(peek.peekingKey.value).toBe("prs");
      expect(peek.peekText.value).toBe("#5 2 new comments, 1 new review: feat");
    });

    it("ブランチ外のPRは出さない", async () => {
      const { peek } = mountPillPeek({ githubPills: true });
      send([ev({ number: 9 })]);
      await nextTick();
      expect(peek.peekingKey.value).toBeNull();
    });

    it("Issueのコメントをissues peekに出す", async () => {
      const { peek } = mountPillPeek({ githubPills: true });
      send([ev({ target: "issue", number: 7, title: "bug" })]);
      await nextTick();
      expect(peek.peekingKey.value).toBe("issues");
      expect(peek.peekText.value).toBe("#7 1 new comment: bug");
    });

    it("複数Issueの新着は1つのpeekにまとめる", async () => {
      const { peek } = mountPillPeek({ githubPills: true });
      send([
        ev({ target: "issue", number: 1 }), ev({ target: "issue", number: 1 }),
        ev({ target: "issue", number: 2 }), ev({ target: "issue", number: 3 }),
      ]);
      await nextTick();
      expect(peek.peekText.value).toBe("3 issues: 4 new comments");
    });

    it("別ワークスペース宛て・対応するピルが無い時は出さない", async () => {
      const { peek } = mountPillPeek({ githubPills: true });
      send([ev({ target: "issue" })], "other");
      await nextTick();
      expect(peek.peekingKey.value).toBeNull();
      const { peek: noPill } = mountPillPeek();
      send([ev({ target: "issue" })]);
      await nextTick();
      expect(noPill.peekingKey.value).toBeNull();
    });

    describe("CI完了", () => {
      const run = (over = {}) => ({
        kind: "run", target: "ci", number: 11, title: "CI", workflow: "CI",
        conclusion: "success", branch: "main", author: null, createdAt: "t", url: "u", ...over,
      });

      it("現在ブランチのrun完了をactions peekに出す", async () => {
        const { peek } = mountPillPeek({ actionsPill: true });
        send([run({ conclusion: "failure" })]);
        await nextTick();
        expect(peek.peekingKey.value).toBe("actions");
        expect(peek.peekText.value).toBe("[CI] failure");
      });

      it("別ブランチのrunは出さない", async () => {
        const { peek } = mountPillPeek({ actionsPill: true });
        send([run({ branch: "feature" })]);
        await nextTick();
        expect(peek.peekingKey.value).toBeNull();
      });

      it("同じrunのイベントが再送されても二重に出さない", async () => {
        vi.useFakeTimers();
        try {
          const { peek } = mountPillPeek({ actionsPill: true });
          send([run()]);
          await nextTick();
          vi.advanceTimersByTime(PILL_PEEK_DURATION_MS + 10);
          expect(peek.peekingKey.value).toBeNull();
          send([run()]);
          await nextTick();
          expect(peek.peekingKey.value).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });

      it("一覧ポーリングが先に完了を検知した場合も、後続のイベントで二重に出さない", async () => {
        vi.useFakeTimers();
        try {
          const { peek, runStatus } = mountPillPeek({ actionsPill: true });
          runStatus.value = "completed";
          await nextTick();
          expect(peek.peekingKey.value).toBe("actions");
          vi.advanceTimersByTime(PILL_PEEK_DURATION_MS + 10);
          send([run()]);
          await nextTick();
          expect(peek.peekingKey.value).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });

      it("実行中への変化は従来どおり一覧の変化から出す", async () => {
        const { peek, runStatus } = mountPillPeek({ actionsPill: true });
        runStatus.value = "in_progress";
        await nextTick();
        expect(peek.peekingKey.value).toBe("actions");
      });
    });
  });

  it("peekが終わったらpeekTextとpeekSignatureから通知文言が消える", async () => {
    vi.useFakeTimers();
    try {
      const { peek } = mountPillPeek({ filesPill: true });
      emit("files:opDone", { wsName: "ws1", text: "Deleted a.txt" });
      await nextTick();
      expect(peek.peekText.value).toBe("Deleted a.txt");
      expect(peek.peekSignature.value).toContain("Deleted a.txt");
      await vi.advanceTimersByTimeAsync(4001);
      expect(peek.peekingKey.value).toBeNull();
      expect(peek.peekText.value).toBe("");
      expect(peek.peekSignature.value ?? "").not.toContain("Deleted a.txt");
    } finally {
      vi.useRealTimers();
    }
  });

  it("peekが終わったらgit remoteの結果も破棄する", async () => {
    vi.useFakeTimers();
    try {
      const { peek } = mountPillPeek();
      const result = { kind: "push", headline: "2 Pushed", detail: "feat: a" };
      emit("git:remoteDone", { wsName: "ws1", result });
      await nextTick();
      expect(peek.branchRemoteResult.value).toEqual(result);
      await vi.advanceTimersByTimeAsync(6001);
      expect(peek.peekingKey.value).toBeNull();
      expect(peek.branchRemoteResult.value).toBeNull();
      expect(peek.peekSignature.value ?? "").not.toContain("2 Pushed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("別セッション宛ての検知イベントは無視する", async () => {
    const { peek } = mountPillPeek();
    emit("session:jobBound", { sessionId: "other" });
    emit("session:workspaceBound", { sessionId: "other" });
    await nextTick();
    expect(peek.peekingKey.value).toBeNull();
  });

  it("git:remoteDoneで自ワークスペースの結果をbranch peekに出す", async () => {
    const { peek } = mountPillPeek();
    const result = { kind: "push", headline: "2 Pushed", detail: "feat: a \u2022 fix: b" };
    emit("git:remoteDone", { wsName: "ws1", result });
    await nextTick();
    expect(peek.peekingKey.value).toBe("branch");
    expect(peek.branchRemoteResult.value).toEqual(result);
    expect(peek.peekSignature.value).toContain("2 Pushed");
  });

  it("別ワークスペース宛てのgit:remoteDoneは無視する", async () => {
    const { peek } = mountPillPeek();
    emit("git:remoteDone", { wsName: "other", result: { kind: "pull", headline: "1 Pulled", detail: "x" } });
    await nextTick();
    expect(peek.peekingKey.value).toBeNull();
  });

  it("branchピルが無い時はgit:remoteDoneで何も出さない", async () => {
    const { peek, branchPillOn } = mountPillPeek();
    branchPillOn.value = false;
    await nextTick();
    emit("git:remoteDone", { wsName: "ws1", result: { kind: "push", headline: "1 Pushed", detail: "x" } });
    await nextTick();
    expect(peek.peekingKey.value).toBeNull();
  });

  it("結果peekを出した直後のahead 0化では「N Pushed」peekを重ねない", async () => {
    const { peek, ahead, upstreamHead } = mountPillPeek({ upstreamHead: "aaa" });
    const result = { kind: "push", headline: "3 Pushed", detail: "feat: a" };
    emit("git:remoteDone", { wsName: "ws1", result });
    await nextTick();
    upstreamHead.value = "bbb";
    ahead.value = 0;
    await nextTick();
    expect(peek.branchRemoteResult.value).toEqual(result);
    expect(peek.branchPushCount.value).toBe(0);
  });
  describe("先行peekの表示中に届いたgit:remoteDone", () => {
    afterEach(() => { vi.useRealTimers(); });

    it("共有枠を使い切られていても結果peekは一定時間表示され続ける", async () => {
      vi.useFakeTimers();
      const { peek, branch } = mountPillPeek();
      // 先行peek（ブランチ名の変化）を表示中にする
      branch.value = "feature";
      await nextTick();
      expect(peek.peekingKey.value).toBe("branch");
      const result = { kind: "pull", headline: "1 Pulled", detail: "feat: a" };
      emit("git:remoteDone", { wsName: "ws1", result });
      await nextTick();
      // 先行peekの枠（PILL_PEEK_DURATION_MS）を過ぎて結果peekに切り替わる
      await vi.advanceTimersByTimeAsync(4001);
      expect(peek.branchRemoteResult.value).toEqual(result);
      // 切り替わった直後に消えず、数秒は残る
      await vi.advanceTimersByTimeAsync(3000);
      expect(peek.peekingKey.value).toBe("branch");
      expect(peek.branchRemoteResult.value).toEqual(result);
    });
  });
  describe("CLI・エージェント経由のpush/pull（件名の取得）", () => {
    it("push完了の検出で件名を取得してpeekに添える", async () => {
      const fetchRecentSubjects = vi.fn(async () => ["feat: a"]);
      const { peek, ahead, upstreamHead } = mountPillPeek({ ahead: 3, fetchRecentSubjects, upstreamHead: "aaa" });
      upstreamHead.value = "bbb";
      ahead.value = 0;
      await nextTick();
      expect(peek.peekingKey.value).toBe("branch");
      expect(peek.branchRemoteResult.value).toMatchObject({ kind: "push", headline: "3 Pushed" });
      expect(fetchRecentSubjects).toHaveBeenCalledWith("ws1", 1);
      await Promise.resolve();
      await Promise.resolve();
      expect(peek.branchRemoteResult.value.detail).toBe("feat: a \u2026 and 2 more");
      expect(peek.peekSignature.value).toContain("feat: a");
    });

    it("pull完了の検出でも件名を添える（件名数が件数より少なければ残件数を付ける）", async () => {
      const fetchRecentSubjects = vi.fn(async () => ["feat: a"]);
      const { peek, behind } = mountPillPeek({ ahead: 0, behind: 5, fetchRecentSubjects });
      behind.value = 0;
      await nextTick();
      expect(peek.branchRemoteResult.value).toMatchObject({ kind: "pull", headline: "5 Pulled" });
      expect(fetchRecentSubjects).toHaveBeenCalledWith("ws1", 1);
      await Promise.resolve();
      await Promise.resolve();
      expect(peek.branchRemoteResult.value.detail).toBe("feat: a \u2026 and 4 more");
    });

    it("件名の取得に失敗（空配列）しても「N Pushed」のpeekは出る", async () => {
      const { peek, ahead, upstreamHead } = mountPillPeek({ ahead: 2, fetchRecentSubjects: async () => [], upstreamHead: "aaa" });
      upstreamHead.value = "bbb";
      ahead.value = 0;
      await nextTick();
      await Promise.resolve();
      await Promise.resolve();
      expect(peek.branchRemoteResult.value).toMatchObject({ kind: "push", headline: "2 Pushed", detail: "" });
    });
  });
});

describe("buildPeekSignature", () => {
  it("peekingKeyが無ければnull", () => {
    expect(buildPeekSignature(null, {})).toBeNull();
  });

  it("changes/branchは専用フォーマット（buildPeekTextを経由しない）", () => {
    expect(buildPeekSignature("changes", { changedFiles: 2, insertions: 5, deletions: 1 })).toBe("changes:2:5:1");
    expect(buildPeekSignature("branch", { branch: "main", ahead: 1, behind: 0 })).toBe("branch:main:1:0");
  });

  it("それ以外はkey:buildPeekText(...)の形式", () => {
    expect(buildPeekSignature("files", {})).toBe("files:Files");
    expect(buildPeekSignature("workspace", { workspaceLabel: "my-ws" })).toBe("workspace:my-ws");
  });
});
