import { describe, it, expect } from "vitest";
import { INFO_PILLS, INFO_PILL_FIELDS, peekIconForKey } from "../../ui/utils/info-pills.js";

describe("INFO_PILLS", () => {
  it("キーは重複しない", () => {
    const keys = INFO_PILLS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("全エントリがkey/label/note/peekIconを持つ", () => {
    for (const p of INFO_PILLS) {
      expect(p.key).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.note).toBeTruthy();
      expect(p.peekIcon).toMatch(/^mdi-/);
    }
  });

  it("フィールド一覧＝デフォルト表示順（並び替え保存が無い時の表示順を規定する）", () => {
    // バックエンド api/routers/settings.py の INFO_PILL_FIELDS と同じキー集合を
    // 保つこと（あちらは tests/test_api_settings.py で検証）。
    expect(INFO_PILL_FIELDS).toEqual([
      "files", "history", "changes", "branch", "prs", "actions", "devserver", "add", "dispatch",
    ]);
  });
});

describe("peekIconForKey", () => {
  it("ピルのキーに対応するアイコンを返す", () => {
    expect(peekIconForKey("branch")).toBe("mdi-source-branch");
    expect(peekIconForKey("devserver")).toBe("mdi-server");
  });

  it("peek専用キー（devserver-stop）にもアイコンを返す", () => {
    expect(peekIconForKey("devserver-stop")).toBe("mdi-server-off");
  });

  it("対応するピルが無いキーは空文字（テンプレート側が実アイコンを描画）", () => {
    expect(peekIconForKey("workspace")).toBe("");
    expect(peekIconForKey(null)).toBe("");
    expect(peekIconForKey(undefined)).toBe("");
  });
});
