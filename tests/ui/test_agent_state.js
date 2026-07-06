import { describe, it, expect } from "vitest";
import {
  agentStateBadge,
  parsePhrasesText,
  phrasesToText,
  buildStatePatterns,
} from "../../ui/utils/agent-state.js";

describe("agentStateBadge", () => {
  it("blocked / done / working はアイコン・クラス・ラベルを返す", () => {
    for (const state of ["blocked", "done", "working"]) {
      const badge = agentStateBadge(state);
      expect(badge).not.toBe(null);
      expect(badge.icon).toMatch(/^mdi-/);
      expect(badge.className).toBe(`agent-state-${state}`);
      expect(badge.label).toBe(`agent ${state}`);
    }
  });

  it("状態ごとにアイコンの形が異なる（色のみで区別しない）", () => {
    const icons = ["blocked", "done", "working"].map((s) => agentStateBadge(s).icon);
    expect(new Set(icons).size).toBe(3);
  });

  it("idle・未知・空は null（無表示）", () => {
    expect(agentStateBadge("idle")).toBe(null);
    expect(agentStateBadge("unknown")).toBe(null);
    expect(agentStateBadge("")).toBe(null);
  });
});

describe("parsePhrasesText", () => {
  it("1 行 1 語句で trim し、空行を捨てる", () => {
    expect(parsePhrasesText("  Do you want to \n\n esc to interrupt\n")).toEqual([
      "Do you want to",
      "esc to interrupt",
    ]);
  });

  it("文字列以外・空文字は空配列", () => {
    expect(parsePhrasesText("")).toEqual([]);
    expect(parsePhrasesText(undefined)).toEqual([]);
    expect(parsePhrasesText(null)).toEqual([]);
  });
});

describe("phrasesToText", () => {
  it("配列を改行区切りへ戻す（parse と往復できる）", () => {
    const phrases = ["a", "b c"];
    expect(phrasesToText(phrases)).toBe("a\nb c");
    expect(parsePhrasesText(phrasesToText(phrases))).toEqual(phrases);
  });

  it("配列以外は空文字", () => {
    expect(phrasesToText(undefined)).toBe("");
    expect(phrasesToText(null)).toBe("");
  });
});

describe("buildStatePatterns", () => {
  it("空でない状態だけキーを含める", () => {
    expect(buildStatePatterns("Do you want to", "")).toEqual({
      blocked: ["Do you want to"],
    });
    expect(buildStatePatterns("", "All done")).toEqual({ done: ["All done"] });
    expect(buildStatePatterns("", "")).toEqual({});
  });

  it("両方あれば両方のキーを含める", () => {
    expect(buildStatePatterns("a\nb", "c")).toEqual({
      blocked: ["a", "b"],
      done: ["c"],
    });
  });
});
