import { describe, it, expect } from "vitest";
import {
  createTrailingPeekState,
  reduceTrailingPeek,
  reduceDevServerStop,
  startPeekSession,
  advancePeekQueue,
} from "../../ui/utils/pill-peek-state.ts";
import { PILL_PEEK_DURATION_MS, PILL_PEEK_REMOTE_DURATION_MS, PILL_PEEK_REMOTE_DEDUP_MS } from "../../ui/utils/constants.ts";

const branchItem = (text) => ({ key: "branch", text });

function baseInput(overrides = {}) {
  return {
    items: [],
    workspace: "ws",
    workspaceResolved: true,
    prsResolved: true,
    actionsResolved: true,
    branch: "main",
    ahead: 0,
    behind: 0,
    upstreamHead: "u1",
    completedActionRun: null,
    canFetchSubjects: false,
    now: 100000,
    lastRemoteResultAt: 0,
    resyncing: false,
    ...overrides,
  };
}

function initialState(items, overrides = {}) {
  return createTrailingPeekState({
    items,
    workspace: "ws",
    upstreamHead: "u1",
    workspaceResolved: true,
    prsResolved: true,
    actionsResolved: true,
    ...overrides,
  });
}

function run(state, input) {
  return reduceTrailingPeek(state, baseInput(input));
}

describe("reduceTrailingPeek: キーの消失と再出現", () => {
  const items = [branchItem("main:0:0")];

  it("再同期中にキーが消えて同じ値で戻っても peek を出さない", () => {
    const vanished = run(initialState(items), { items: [], resyncing: true });
    expect(vanished.effects).toEqual([]);
    const back = run(vanished.state, { items });
    expect(back.effects).toEqual([]);
  });

  it("再同期中にキーが消えて違う値で戻ったら peek を出す", () => {
    const vanished = run(initialState(items), { items: [], resyncing: true });
    const back = run(vanished.state, { items: [branchItem("dev:0:0")] });
    expect(back.effects).toEqual([{ type: "peek", key: "branch", pushCount: 0, pullCount: 0 }]);
  });

  it("同期済みでキーが消えて再び現れたら（値が同じでも）peek を出す", () => {
    const vanished = run(initialState(items), { items: [], resyncing: false });
    const back = run(vanished.state, { items });
    expect(back.effects).toEqual([{ type: "peek", key: "branch", pushCount: 0, pullCount: 0 }]);
  });

  it("入力の状態は書き換えない", () => {
    const state = initialState(items);
    run(state, { items: [], resyncing: false });
    expect([...state.signature.entries()]).toEqual([["branch", "main:0:0"]]);
    expect([...state.itemKeys]).toEqual(["branch"]);
  });
});

describe("reduceTrailingPeek: push/pull 件数", () => {
  const start = () => initialState([branchItem("main:3:2")]);

  it("aheadが0になりupstreamが動いた → push件数を出す", () => {
    const { effects } = run(start(), { items: [branchItem("main:0:2")], ahead: 0, behind: 2, upstreamHead: "u2" });
    expect(effects).toEqual([{ type: "peek", key: "branch", pushCount: 3, pullCount: 0 }]);
  });

  it("aheadが0になってもupstreamが動いていなければ push 扱いにしない", () => {
    const { effects } = run(start(), { items: [branchItem("main:0:2")], ahead: 0, behind: 2, upstreamHead: "u1" });
    expect(effects).toEqual([{ type: "peek", key: "branch", pushCount: 0, pullCount: 0 }]);
  });

  it("ブランチ名が変わった場合は件数を出さない", () => {
    const { effects } = run(start(), {
      items: [branchItem("dev:0:0")], branch: "dev", ahead: 0, behind: 0, upstreamHead: "u2",
    });
    expect(effects).toEqual([{ type: "peek", key: "branch", pushCount: 0, pullCount: 0 }]);
  });

  it("behindが0になった → pull件数を出す", () => {
    const { effects } = run(start(), { items: [branchItem("main:3:0")], ahead: 3, behind: 0 });
    expect(effects).toEqual([{ type: "peek", key: "branch", pushCount: 0, pullCount: 2 }]);
  });

  it("aheadとbehindが同時に0になった（upstream移動あり）→ 両方の件数を載せた1件の peek", () => {
    const { effects } = run(start(), { items: [branchItem("main:0:0")], upstreamHead: "u2" });
    expect(effects).toEqual([{ type: "peek", key: "branch", pushCount: 3, pullCount: 2 }]);
  });

  it("canFetchSubjects かつ片方向だけなら件名取得つきの peek にする", () => {
    const push = run(start(), { items: [branchItem("main:0:2")], behind: 2, upstreamHead: "u2", canFetchSubjects: true });
    expect(push.effects).toEqual([{ type: "branchSubjectPeek", kind: "push", total: 3 }]);
    const pull = run(start(), { items: [branchItem("main:3:0")], ahead: 3, canFetchSubjects: true });
    expect(pull.effects).toEqual([{ type: "branchSubjectPeek", kind: "pull", total: 2 }]);
  });

  it("canFetchSubjects でも両方向なら通常の peek にする", () => {
    const { effects } = run(start(), { items: [branchItem("main:0:0")], upstreamHead: "u2", canFetchSubjects: true });
    expect(effects).toEqual([{ type: "peek", key: "branch", pushCount: 3, pullCount: 2 }]);
  });

  it("dedup 時間内の push/pull は出さない", () => {
    const input = { items: [branchItem("main:0:2")], behind: 2, upstreamHead: "u2" };
    const within = run(start(), { ...input, now: 100000, lastRemoteResultAt: 100000 - PILL_PEEK_REMOTE_DEDUP_MS + 1 });
    expect(within.effects).toEqual([]);
    const after = run(start(), { ...input, now: 100000, lastRemoteResultAt: 100000 - PILL_PEEK_REMOTE_DEDUP_MS });
    expect(after.effects).toEqual([{ type: "peek", key: "branch", pushCount: 3, pullCount: 0 }]);
  });

  it("dedup は件数を伴わない branch の変化には効かない", () => {
    const { effects } = run(initialState([branchItem("main:0:0")]), {
      items: [branchItem("main:1:0")], ahead: 1, now: 100000, lastRemoteResultAt: 100000,
    });
    expect(effects).toEqual([{ type: "peek", key: "branch", pushCount: 0, pullCount: 0 }]);
  });
});

describe("reduceTrailingPeek: upstreamHead の更新", () => {
  it("branchがある間は upstreamHead を追従する", () => {
    const { state } = run(initialState([branchItem("main:0:0")]), { items: [branchItem("main:0:0")], upstreamHead: "u2" });
    expect(state.upstreamHead).toBe("u2");
  });

  it("branchの前の値を残している間は upstreamHead を動かさない", () => {
    const { state } = run(initialState([branchItem("main:2:0")]), { items: [], resyncing: true, upstreamHead: "u2" });
    expect(state.signature.get("branch")).toBe("main:2:0");
    expect(state.upstreamHead).toBe("u1");
  });

  it("branchを捨てた後は upstreamHead を追従する", () => {
    const { state } = run(initialState([branchItem("main:2:0")]), { items: [], resyncing: false, upstreamHead: "u2" });
    expect(state.signature.has("branch")).toBe(false);
    expect(state.upstreamHead).toBe("u2");
  });
});

describe("reduceTrailingPeek: 初回解決のベースライン", () => {
  it("workspaceが初めて解決した回は peek を出さずベースラインだけ更新する", () => {
    const state = initialState([], { workspaceResolved: false });
    const first = run(state, { items: [branchItem("main:0:0")], workspaceResolved: true });
    expect(first.effects).toEqual([]);
    expect(first.state.workspaceEverResolved).toBe(true);
    const second = run(first.state, { items: [branchItem("main:0:0")], workspaceResolved: true });
    expect(second.effects).toEqual([]);
  });

  it("workspace未解決の間は変化を peek にしない", () => {
    const state = initialState([], { workspaceResolved: false });
    const { effects } = run(state, { items: [branchItem("main:0:0")], workspaceResolved: false });
    expect(effects).toEqual([]);
  });

  it("prs が初めて解決した回は prs の出現を peek にしない", () => {
    const state = initialState([], { prsResolved: false });
    const first = run(state, { items: [{ key: "prs", text: "1:t" }], prsResolved: true });
    expect(first.effects).toEqual([]);
    expect(first.state.prsEverResolved).toBe(true);
    const changed = run(first.state, { items: [{ key: "prs", text: "1:t2" }] });
    expect(changed.effects).toEqual([{ type: "peek", key: "prs", pushCount: 0, pullCount: 0 }]);
  });

  it("actions が初めて解決した回は actions の出現を peek にしない", () => {
    const state = initialState([], { actionsResolved: false });
    const first = run(state, { items: [{ key: "actions", text: "1:queued:" }], actionsResolved: true });
    expect(first.effects).toEqual([]);
  });

  it("prs が未解決のうちは prs の出現はそのまま peek 対象", () => {
    const { effects } = run(initialState([], { prsResolved: false }), {
      items: [{ key: "prs", text: "1:t" }], prsResolved: false,
    });
    expect(effects).toEqual([{ type: "peek", key: "prs", pushCount: 0, pullCount: 0 }]);
  });
});

describe("reduceTrailingPeek: 完了済み CI run の claim", () => {
  it("completed の run があれば claimRunId を effect に載せる", () => {
    const { effects } = run(initialState([{ key: "actions", text: "7:in_progress:" }]), {
      items: [{ key: "actions", text: "7:completed:success" }],
      completedActionRun: { id: 7 },
    });
    expect(effects).toEqual([{ type: "peek", key: "actions", pushCount: 0, pullCount: 0, claimRunId: 7 }]);
  });

  it("completed でなければ claimRunId を載せない", () => {
    const { effects } = run(initialState([{ key: "actions", text: "7:queued:" }]), {
      items: [{ key: "actions", text: "7:in_progress:" }],
    });
    expect(effects).toEqual([{ type: "peek", key: "actions", pushCount: 0, pullCount: 0 }]);
  });

  it("actions 以外のキーには claimRunId を載せない", () => {
    const { effects } = run(initialState([branchItem("main:0:0")]), {
      items: [branchItem("dev:0:0")], completedActionRun: { id: 7 },
    });
    expect(effects[0]).not.toHaveProperty("claimRunId");
  });
});

describe("reduceTrailingPeek: ワークスペース切替", () => {
  const wsItem = (text) => ({ key: "workspace", text });

  it("切替前に消えていたキーの保持値は捨てる", () => {
    const state = initialState([branchItem("main:0:0")]);
    const vanished = run(state, { items: [], resyncing: true });
    expect(vanished.state.signature.has("branch")).toBe(true);
    const switched = run(vanished.state, { items: [], workspace: "ws2", resyncing: true });
    expect(switched.state.signature.has("branch")).toBe(false);
    expect(switched.state.workspace).toBe("ws2");
  });

  it("切替後に両方にあるキーが違う値でも peek せず、workspace だけ peek する", () => {
    const state = initialState([wsItem("A"), branchItem("main:0:0")]);
    const { effects, state: next } = run(state, { items: [wsItem("B"), branchItem("dev:0:0")], workspace: "ws2", branch: "dev" });
    expect(effects).toEqual([{ type: "peek", key: "workspace", pushCount: 0, pullCount: 0 }]);
    expect(next.signature.get("branch")).toBe("dev:0:0");
  });

  it("切替後に前のワークスペースの件数を push/pull として出さない", () => {
    const state = initialState([branchItem("main:3:2")]);
    const { effects } = run(state, { items: [branchItem("main:0:0")], workspace: "ws2", upstreamHead: "u9" });
    expect(effects).toEqual([]);
  });

  it("切替の次の回からは通常どおり変化を検出する", () => {
    const state = initialState([wsItem("A"), branchItem("main:0:0")]);
    const switched = run(state, { items: [wsItem("B"), branchItem("dev:0:0")], workspace: "ws2", branch: "dev" });
    const changed = run(switched.state, { items: [wsItem("B"), branchItem("dev:1:0")], workspace: "ws2", branch: "dev", ahead: 1 });
    expect(changed.effects).toEqual([{ type: "peek", key: "branch", pushCount: 0, pullCount: 0 }]);
  });

  it("切替で前のワークスペースにだけあったキーは保持しない", () => {
    const state = initialState([wsItem("A"), { key: "prs", text: "1:t" }]);
    const { state: next } = run(state, { items: [wsItem("B")], workspace: "ws2", resyncing: true });
    expect(next.signature.has("prs")).toBe(false);
  });
});

describe("reduceDevServerStop", () => {
  it("同期済みで消えたら即 fire", () => {
    expect(reduceDevServerStop(false, { type: "entryChanged", present: false, hadPrevious: true, settled: true }))
      .toEqual({ pending: false, fire: true });
  });

  it("同期前に消えたら保留し、同期後もいなければ1回だけ fire", () => {
    const held = reduceDevServerStop(false, { type: "entryChanged", present: false, hadPrevious: true, settled: false });
    expect(held).toEqual({ pending: true, fire: false });
    const settled = reduceDevServerStop(held.pending, { type: "settledChanged", settled: true, present: false });
    expect(settled).toEqual({ pending: false, fire: true });
    const again = reduceDevServerStop(settled.pending, { type: "settledChanged", settled: true, present: false });
    expect(again.fire).toBe(false);
  });

  it("同期前に戻ってきたら fire しない", () => {
    const held = reduceDevServerStop(false, { type: "entryChanged", present: false, hadPrevious: true, settled: false });
    const back = reduceDevServerStop(held.pending, { type: "entryChanged", present: true, hadPrevious: false, settled: false });
    expect(back).toEqual({ pending: false, fire: false });
    expect(reduceDevServerStop(back.pending, { type: "settledChanged", settled: true, present: true }).fire).toBe(false);
  });

  it("同期後に戻っていれば保留を捨てて fire しない", () => {
    expect(reduceDevServerStop(true, { type: "settledChanged", settled: true, present: true }))
      .toEqual({ pending: false, fire: false });
  });

  it("未同期のままの settled 通知では保留を保つ", () => {
    expect(reduceDevServerStop(true, { type: "settledChanged", settled: false, present: false }))
      .toEqual({ pending: true, fire: false });
  });

  it("もともと無かったものが無いままなら何もしない", () => {
    expect(reduceDevServerStop(false, { type: "entryChanged", present: false, hadPrevious: false, settled: true }))
      .toEqual({ pending: false, fire: false });
  });
});

describe("startPeekSession / advancePeekQueue", () => {
  const item = (key, extra = {}) => ({ key, pushCount: 0, pullCount: 0, remote: null, guaranteed: false, text: "", ...extra });
  const remote = { kind: "push", headline: "1 Pushed", detail: "" };

  it("セッション終了時刻は remote なら REMOTE 表示時間、通常は標準時間", () => {
    expect(startPeekSession(null, 1000)).toBe(1000 + PILL_PEEK_DURATION_MS);
    expect(startPeekSession(remote, 1000)).toBe(1000 + PILL_PEEK_REMOTE_DURATION_MS);
  });

  it("空のキューは item なしで終了時刻を変えない", () => {
    expect(advancePeekQueue([], 5000, 1000)).toEqual({ item: null, queue: [], itemMs: 0, nextSessionEndsAt: 5000 });
  });

  it("残り時間を残件数（自分を含む）で等分する", () => {
    const endsAt = 1000 + PILL_PEEK_DURATION_MS;
    const r = advancePeekQueue([item("a"), item("b")], endsAt, 1000);
    expect(r.item.key).toBe("a");
    expect(r.queue.map((q) => q.key)).toEqual(["b"]);
    expect(r.itemMs).toBe(Math.round(PILL_PEEK_DURATION_MS / 2));
    expect(r.nextSessionEndsAt).toBe(endsAt);
  });

  it("残り時間が尽きていても最低 1ms", () => {
    expect(advancePeekQueue([item("a")], 1000, 5000).itemMs).toBe(1);
  });

  it("guaranteed は標準時間を下回らず、セッション終了時刻を延ばす", () => {
    const r = advancePeekQueue([item("w", { guaranteed: true })], 1000, 5000);
    expect(r.itemMs).toBe(PILL_PEEK_DURATION_MS);
    expect(r.nextSessionEndsAt).toBe(5000 + PILL_PEEK_DURATION_MS);
  });

  it("remote は REMOTE 表示時間を下回らない", () => {
    const r = advancePeekQueue([item("branch", { remote })], 1000, 5000);
    expect(r.itemMs).toBe(PILL_PEEK_REMOTE_DURATION_MS);
    expect(r.nextSessionEndsAt).toBe(5000 + PILL_PEEK_REMOTE_DURATION_MS);
  });

  it("共有枠のほうが長ければ guaranteed でも共有枠を使い、終了時刻は縮めない", () => {
    const endsAt = 5000 + PILL_PEEK_DURATION_MS * 4;
    const r = advancePeekQueue([item("w", { guaranteed: true })], endsAt, 5000);
    expect(r.itemMs).toBe(PILL_PEEK_DURATION_MS * 4);
    expect(r.nextSessionEndsAt).toBe(endsAt);
  });

  it("入力のキューは書き換えない", () => {
    const queue = [item("a"), item("b")];
    advancePeekQueue(queue, 5000, 1000);
    expect(queue).toHaveLength(2);
  });
});
