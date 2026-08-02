import { describe, it, expect } from "vitest";
import { cwdBaseName, resolveBareTerminalFilesDetail, resolveRegisterCurrentDirAction } from "../../ui/utils/bare-terminal-actions.js";

describe("cwdBaseName", () => {
  it("パスの末尾ディレクトリ名を返す", () => {
    expect(cwdBaseName("/Users/k-takasaki/work/any-console")).toBe("any-console");
  });

  it("末尾スラッシュがあっても末尾ディレクトリ名を返す", () => {
    expect(cwdBaseName("/Users/k-takasaki/work/any-console/")).toBe("any-console");
  });

  it("ルートパスはそのまま返す", () => {
    expect(cwdBaseName("/")).toBe("/");
  });
});

describe("resolveBareTerminalFilesDetail", () => {
  it("sessionId と cwd があれば terminalSessionId と rootLabel を含める", () => {
    const detail = resolveBareTerminalFilesDetail("s1", "/Users/k-takasaki/work/current-dir");
    expect(detail).toEqual({
      pane: "files",
      terminalSessionId: "s1",
      rootLabel: "current-dir",
    });
  });

  it("cwd が空なら rootLabel は terminal になる", () => {
    const detail = resolveBareTerminalFilesDetail("s1", "");
    expect(detail).toEqual({
      pane: "files",
      terminalSessionId: "s1",
      rootLabel: "terminal",
    });
  });

  it("sessionId が無ければ pane のみ返す", () => {
    const detail = resolveBareTerminalFilesDetail(null, "");
    expect(detail).toEqual({ pane: "files" });
  });
});

describe("resolveRegisterCurrentDirAction", () => {
  it("cwd が不明なら openModal", () => {
    expect(resolveRegisterCurrentDirAction("", [])).toEqual({ type: "openModal" });
  });

  it("既存ワークスペースと cwd が一致すれば launch", () => {
    const workspaces = [{ name: "any-console", path: "/work/any-console", icon: "mdi-console", icon_color: "#fff" }];
    expect(resolveRegisterCurrentDirAction("/work/any-console", workspaces)).toEqual({
      type: "launch",
      workspace: "any-console",
      icon: "mdi-console",
      iconColor: "#fff",
    });
  });

  it("一致するワークスペースが無ければ openAdd", () => {
    expect(resolveRegisterCurrentDirAction("/work/new-dir", [])).toEqual({
      type: "openAdd",
      initialPath: "/work/new-dir",
    });
  });
});
