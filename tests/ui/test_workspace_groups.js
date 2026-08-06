// @ts-check
import { describe, it, expect } from "vitest";
import { buildFlatList, deriveGroupChanges, workspacesInGroup } from "../../ui/utils/workspace-groups.js";

describe("workspacesInGroup", () => {
  const list = [
    { name: "a" },
    { name: "b", group_id: "g1" },
    // ベースが登録済みのworktreeは一覧から除外される（ベース行の下に別途表示）
    { name: "a-feat", worktree: true, worktree_base: "a" },
    // ベース未登録のworktreeは通常ワークスペースとして表示される
    { name: "orphan-feat", worktree: true, worktree_base: "gone" },
  ];

  it("groupId未指定はグループ未所属（トップレベル）を返す", () => {
    expect(workspacesInGroup(list, null).map((w) => w.name)).toEqual(["a", "orphan-feat"]);
    expect(workspacesInGroup(list).map((w) => w.name)).toEqual(["a", "orphan-feat"]);
  });

  it("groupId指定はそのグループのワークスペースだけ返す", () => {
    expect(workspacesInGroup(list, "g1").map((w) => w.name)).toEqual(["b"]);
    expect(workspacesInGroup(list, "g2")).toEqual([]);
  });
});

// テスト用ヘルパー
const ws = (name, groupId = null) => ({ name, id: name, group_id: groupId });
const group = (id, name = id) => ({ id, name });
const getGroupWs = (allWs) => (groupId) => allWs.filter((w) => w.group_id === groupId);

// ---- buildFlatList ----

describe("buildFlatList", () => {
  it("グループなしWSだけの場合はそのままフラット化する", () => {
    const wsList = [ws("a"), ws("b")];
    const result = buildFlatList(wsList, [], getGroupWs(wsList));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "ws", groupId: null, ws: { name: "a" } });
    expect(result[1]).toMatchObject({ type: "ws", groupId: null, ws: { name: "b" } });
  });

  it("グループなし→ヘッダー→グループ内WSの順で並ぶ", () => {
    const all = [ws("ung"), ws("g1ws", "g1")];
    const groups = [group("g1", "Group A")];
    const result = buildFlatList([all[0]], groups, getGroupWs(all));
    expect(result[0]).toMatchObject({ type: "ws", groupId: null });
    expect(result[1]).toMatchObject({ type: "header", group: { id: "g1" } });
    expect(result[2]).toMatchObject({ type: "ws", groupId: "g1" });
  });

  it("複数グループが順序通りに並ぶ", () => {
    const all = [ws("w1", "g1"), ws("w2", "g2")];
    const groups = [group("g1"), group("g2")];
    const result = buildFlatList([], groups, getGroupWs(all));
    const types = result.map((r) => r.type);
    expect(types).toEqual(["header", "ws", "header", "ws"]);
    expect(result[0].group.id).toBe("g1");
    expect(result[2].group.id).toBe("g2");
  });

  it("折りたたみ中のグループはWSを含まない", () => {
    const all = [ws("w1", "g1"), ws("w2", "g2")];
    const groups = [group("g1"), group("g2")];
    const collapsed = new Set(["g1"]);
    const result = buildFlatList([], groups, getGroupWs(all), collapsed);
    // g1: header のみ, g2: header + ws
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: "header", group: { id: "g1" } });
    expect(result[1]).toMatchObject({ type: "header", group: { id: "g2" } });
    expect(result[2]).toMatchObject({ type: "ws", groupId: "g2" });
  });

  it("groupIdx がグループの配列インデックスと一致する", () => {
    const groups = [group("g1"), group("g2"), group("g3")];
    const result = buildFlatList([], groups, () => []);
    const headers = result.filter((r) => r.type === "header");
    expect(headers[0].groupIdx).toBe(0);
    expect(headers[1].groupIdx).toBe(1);
    expect(headers[2].groupIdx).toBe(2);
  });

  it("グループが空でもヘッダーは表示される", () => {
    const result = buildFlatList([], [group("g1")], () => []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "header" });
  });

  it("ワークスペースが空のとき空配列を返す", () => {
    expect(buildFlatList([], [], () => [])).toHaveLength(0);
  });
});

// ---- deriveGroupChanges ----

describe("deriveGroupChanges", () => {
  it("変更なしの場合 changes が空", () => {
    const list = [
      { type: "header", group: { id: "g1" } },
      { type: "ws", ws: ws("w1", "g1"), groupId: "g1" },
    ];
    const { changes } = deriveGroupChanges(list);
    expect(changes).toHaveLength(0);
  });

  it("グループ内→グループなしに移動した変更を検出する", () => {
    // w1 がグループなし先頭に来た状態（もともとは g1 所属）
    const list = [
      { type: "ws", ws: ws("w1", "g1"), groupId: "g1" },
      { type: "header", group: { id: "g1" } },
    ];
    const { changes } = deriveGroupChanges(list);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ newGroupId: null, ws: { name: "w1" } });
  });

  it("グループなし→グループ内に移動した変更を検出する", () => {
    const list = [
      { type: "header", group: { id: "g1" } },
      { type: "ws", ws: ws("w1", null), groupId: null },
    ];
    const { changes } = deriveGroupChanges(list);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ newGroupId: "g1", ws: { name: "w1" } });
  });

  it("グループ間の移動を検出する", () => {
    const list = [
      { type: "header", group: { id: "g1" } },
      { type: "ws", ws: ws("w1", "g2"), groupId: "g2" }, // g2 → g1 に移動
      { type: "header", group: { id: "g2" } },
      { type: "ws", ws: ws("w2", "g2"), groupId: "g2" },
    ];
    const { changes } = deriveGroupChanges(list);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ newGroupId: "g1", ws: { name: "w1" } });
  });

  it("visibleOrder が ws の id/name 順で返る", () => {
    const list = [
      { type: "header", group: { id: "g1" } },
      { type: "ws", ws: { name: "b", id: "b" }, groupId: "g1" },
      { type: "ws", ws: { name: "a", id: "a" }, groupId: "g1" },
    ];
    const { visibleOrder } = deriveGroupChanges(list);
    expect(visibleOrder).toEqual(["b", "a"]);
  });

  it("id がなければ name を使う", () => {
    const list = [
      { type: "ws", ws: { name: "my-ws" }, groupId: null },
    ];
    const { visibleOrder } = deriveGroupChanges(list);
    expect(visibleOrder).toEqual(["my-ws"]);
  });

  it("複数の変更を同時に検出する", () => {
    const list = [
      { type: "ws", ws: ws("w1", "g1"), groupId: "g1" }, // g1→null
      { type: "header", group: { id: "g1" } },
      { type: "ws", ws: ws("w2", null), groupId: null },  // null→g1
    ];
    const { changes } = deriveGroupChanges(list);
    expect(changes).toHaveLength(2);
  });
});
